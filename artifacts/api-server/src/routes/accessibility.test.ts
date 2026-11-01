// Route tests for the accessibility-prefs endpoints (spec §6.8, §7 row 9).
// The prefs data port, audit, and session boundary run as in-memory fakes —
// what is proven here is the route's persistence semantics (lazy defaults,
// partial-update merge, validation, per-caller isolation) at the API
// boundary. No database, so they run everywhere; the drizzle port's SQL is
// exercised by typecheck and the db round-trip suite.

import express, { type Express, type RequestHandler } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AccessibilityPrefs, User } from "@workspace/db/schema";
import type { GuardianAccessPort } from "../auth/authorize";
import type { AuditEntry, AuditPort } from "../auth/audit";
import type { AuthedRequest } from "../auth/middleware";
import { SessionError } from "../auth/session";
import { errorHandler } from "../middlewares/errorHandler";
import {
  createAccessibilityRoutes,
  type AccessibilityDeps,
} from "./accessibility";
import type { AccessibilityDataPort } from "../accessibility/accessibility-data";

const ALICE_ID = "00000000-0000-4000-8000-000000000001";
const BOB_ID = "00000000-0000-4000-8000-000000000002";

const NOW = new Date("2026-11-01T10:00:00.000Z");

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `00000000-0000-4000-8000-${idCounter.toString(16).padStart(12, "0")}`;
}

function fakeUser(id: string, role: User["role"]): User {
  return {
    id,
    email: `${role}@primer.test`,
    passwordHash: "test-hash",
    role,
    displayName: `Test ${role}`,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function defaultRow(userId: string): AccessibilityPrefs {
  return {
    id: nextId(),
    userId,
    ttsEnabled: false,
    captionsEnabled: true,
    highContrast: false,
    textSize: "medium",
    reducedMotion: false,
    aacInputEnabled: false,
    allowBreaks: true,
    breakIntervalMinutes: 20,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** In-memory AccessibilityDataPort — rows keyed by userId, PUT merges patches. */
function fakePrefsData() {
  const rows = new Map<string, AccessibilityPrefs>();

  const port: AccessibilityDataPort = {
    async ensurePrefs(userId) {
      let row = rows.get(userId);
      if (!row) {
        row = defaultRow(userId);
        rows.set(userId, row);
      }
      return row;
    },
    async updatePrefs(userId, patch) {
      const row = await port.ensurePrefs(userId);
      const updated = { ...row, ...patch, updatedAt: NOW };
      rows.set(userId, updated);
      return updated;
    },
  };

  return { port, rows };
}

interface FakeDeps {
  deps: AccessibilityDeps;
  currentUser: { value: User | undefined };
  auditLog: AuditEntry[];
  data: ReturnType<typeof fakePrefsData>;
}

function fakeDeps(): FakeDeps {
  const data = fakePrefsData();
  const currentUser: { value: User | undefined } = { value: undefined };
  const auditLog: AuditEntry[] = [];

  const audit: AuditPort = {
    async record(entry) {
      auditLog.push(entry);
    },
  };

  const guardianAccess: GuardianAccessPort = {
    async hasGrantedGuardianAccess() {
      return false;
    },
    async getGuardianLink() {
      return undefined;
    },
  };

  // Test-only session boundary: the real requireAuth (codec + user lookup) is
  // covered by the auth suite; here the policy under test is authorize().
  const authenticate: RequestHandler = (req, _res, next) => {
    if (currentUser.value) (req as AuthedRequest).user = currentUser.value;
    next();
  };

  return {
    deps: {
      db: () => undefined as never,
      codec: undefined as never,
      passwords: {
        hash: async () => "unused",
        verify: async () => false,
      },
      audit,
      guardianAccess,
      data: data.port,
      authenticate,
    },
    currentUser,
    auditLog,
    data,
  };
}

interface JsonBody {
  code?: string;
  message?: string;
  ttsEnabled?: boolean;
  captionsEnabled?: boolean;
  highContrast?: boolean;
  textSize?: string;
  reducedMotion?: boolean;
  aacInputEnabled?: boolean;
  allowBreaks?: boolean;
  breakIntervalMinutes?: number;
  userId?: string;
}

type Result = { status: number; body: JsonBody };

describe("accessibility prefs routes (in-memory fakes, spec §6.8)", () => {
  let server: http.Server;
  let baseUrl: string;
  let harness: FakeDeps;

  beforeAll(async () => {
    harness = fakeDeps();
    const app: Express = express();
    app.use(express.json());
    app.use("/me", createAccessibilityRoutes(harness.deps));
    app.use(errorHandler);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/me/accessibility`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    harness.currentUser.value = undefined;
    harness.auditLog.length = 0;
    harness.data.rows.clear();
  });

  async function call(method: string, path: string, body?: unknown): Promise<Result> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: JsonBody;
    try {
      json = text === "" ? {} : (JSON.parse(text) as JsonBody);
    } catch {
      throw new Error(
        `non-JSON ${res.status} for ${method} ${path}: ${text.slice(0, 600)}`,
      );
    }
    return { status: res.status, body: json };
  }

  function asUser(id: string, role: User["role"] = "student") {
    harness.currentUser.value = fakeUser(id, role);
  }

  describe("lazy defaults", () => {
    it("creates product defaults on first read (captions on, TTS off)", async () => {
      asUser(ALICE_ID);
      const res = await call("GET", "/");
      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(ALICE_ID);
      expect(res.body.captionsEnabled).toBe(true);
      expect(res.body.ttsEnabled).toBe(false);
      expect(res.body.highContrast).toBe(false);
      expect(res.body.textSize).toBe("medium");
      expect(res.body.reducedMotion).toBe(false);
      expect(res.body.aacInputEnabled).toBe(false);
      expect(res.body.allowBreaks).toBe(true);
      expect(res.body.breakIntervalMinutes).toBe(20);
    });

    it("returns the same row on repeated reads — no duplicate settings", async () => {
      asUser(ALICE_ID);
      const first = await call("GET", "/");
      const second = await call("GET", "/");
      expect(harness.data.rows.size).toBe(1);
      expect(second.status).toBe(200);
      expect(first.status).toBe(200);
    });
  });

  describe("partial update with persistence", () => {
    it("persists a PUT and a later GET reads it back", async () => {
      asUser(ALICE_ID);
      const put = await call("PUT", "/", {
        ttsEnabled: true,
        textSize: "xlarge",
        breakIntervalMinutes: 15,
      });
      expect(put.status).toBe(200);
      expect(put.body.ttsEnabled).toBe(true);
      expect(put.body.textSize).toBe("xlarge");
      expect(put.body.breakIntervalMinutes).toBe(15);

      const get = await call("GET", "/");
      expect(get.status).toBe(200);
      expect(get.body.ttsEnabled).toBe(true);
      expect(get.body.textSize).toBe("xlarge");
      expect(get.body.breakIntervalMinutes).toBe(15);
    });

    it("moves only the sent keys — the rest keep their stored values", async () => {
      asUser(ALICE_ID);
      await call("PUT", "/", { highContrast: true, textSize: "large" });
      const res = await call("PUT", "/", { highContrast: false });
      expect(res.status).toBe(200);
      expect(res.body.highContrast).toBe(false);
      expect(res.body.textSize).toBe("large");
    });

    it("allows a first-touch PUT before any GET (row is created, then updated)", async () => {
      asUser(BOB_ID);
      const res = await call("PUT", "/", { reducedMotion: true });
      expect(res.status).toBe(200);
      expect(res.body.reducedMotion).toBe(true);
      expect(res.body.captionsEnabled).toBe(true); // untouched default survives
    });

    it("rejects a break interval outside 1–240 and writes nothing", async () => {
      asUser(ALICE_ID);
      for (const bad of [0, 241, 12.5]) {
        const res = await call("PUT", "/", { breakIntervalMinutes: bad });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("invalid_request");
      }
      expect(harness.data.rows.size).toBe(0);
    });

    it("rejects an unknown textSize value", async () => {
      asUser(ALICE_ID);
      const res = await call("PUT", "/", { textSize: "enormous" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("invalid_request");
    });
  });

  describe("per-caller isolation", () => {
    it("keeps two callers' settings separate — no shared or leaked rows", async () => {
      asUser(ALICE_ID);
      await call("PUT", "/", { textSize: "xlarge" });
      asUser(BOB_ID);
      const bob = await call("GET", "/");
      expect(bob.body.userId).toBe(BOB_ID);
      expect(bob.body.textSize).toBe("medium"); // Bob never sees Alice's pick
      expect(harness.data.rows.size).toBe(2);
    });

    it("audits both the read and the write as allowed self-access", async () => {
      asUser(ALICE_ID);
      await call("GET", "/");
      await call("PUT", "/", { ttsEnabled: true });
      const actions = harness.auditLog.map((e) => e.action);
      expect(actions).toContain("view_progress");
      expect(actions).toContain("edit_profile");
      expect(harness.auditLog.every((e) => e.decision === "allowed")).toBe(true);
      expect(
        harness.auditLog.every((e) => e.resourceId === ALICE_ID),
      ).toBe(true);
    });
  });

  describe("session boundary", () => {
    it("401s an anonymous caller through the real requireAuth", async () => {
      // Real session mechanics with a codec that always rejects: no valid
      // cookie, no prefs. The auth suite covers the codec itself.
      const app: Express = express();
      app.use(express.json());
      app.use(
        "/me",
        createAccessibilityRoutes({
          ...harness.deps,
          authenticate: undefined,
          codec: {
            sign: () => "unused",
            verify: () => {
              throw new SessionError();
            },
          },
        }),
      );
      app.use(errorHandler);
      const standalone = http.createServer(app);
      await new Promise<void>((resolve) => standalone.listen(0, "127.0.0.1", resolve));
      try {
        const address = standalone.address() as AddressInfo;
        const res = await fetch(
          `http://127.0.0.1:${address.port}/me/accessibility`,
        );
        expect(res.status).toBe(401);
      } finally {
        await new Promise<void>((resolve) => standalone.close(() => resolve()));
      }
    });
  });
});
