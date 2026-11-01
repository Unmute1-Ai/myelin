// Route tests for the accessibility-preference endpoints (contract:
// GET/PATCH /me/accessibility; spec §6.8). In-memory fakes for the prefs
// port, audit, and the session boundary. What is proven here: any signed-in
// user may read and update their own preferences (no diagnosis gate), the
// ensure-on-read keeps first visits alive, and invalid updates never land.

import express, { type Express, type RequestHandler } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AccessibilityPrefs, User } from "@workspace/db/schema";
import type { GuardianAccessPort } from "../auth/authorize";
import type { AuditEntry, AuditPort } from "../auth/audit";
import type { AuthedRequest } from "../auth/middleware";
import { createMeRoutes, type MeDeps } from "./me";
import type {
  AccessibilityDataPort,
  AccessibilityPrefsPatch,
} from "../accessibility/accessibility-service";
import { errorHandler } from "../middlewares/errorHandler";

const USER_ID = "00000000-0000-4000-8000-000000000001";

const NOW = new Date("2026-11-01T10:00:00.000Z");

function fakeUser(id = USER_ID, role: User["role"] = "student"): User {
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

function defaultPrefs(userId: string): AccessibilityPrefs {
  return {
    id: "00000000-0000-4000-8000-0000000000a1",
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

/** In-memory AccessibilityDataPort — records the patches the routes issued. */
function fakeAccessibilityData() {
  const rows = new Map<string, AccessibilityPrefs>();
  const patches: Array<{ userId: string; patch: AccessibilityPrefsPatch }> = [];

  const port: AccessibilityDataPort = {
    async ensurePrefs(userId) {
      let row = rows.get(userId);
      if (!row) {
        row = defaultPrefs(userId);
        rows.set(userId, row);
      }
      return row;
    },
    async updatePrefs(userId, patch) {
      patches.push({ userId, patch });
      const row = await port.ensurePrefs(userId);
      const updated = { ...row, ...patch, updatedAt: NOW };
      // Mirror the DB CHECK: the service layer may reject the same things.
      if (updated.breakIntervalMinutes < 1 || updated.breakIntervalMinutes > 240) {
        throw new Error('Failed constraint "accessibility_break_interval_range"');
      }
      rows.set(userId, updated);
      return updated;
    },
  };

  return { port, rows, patches };
}

interface FakeDeps {
  deps: MeDeps;
  currentUser: { value: User | undefined };
  auditLog: AuditEntry[];
  data: ReturnType<typeof fakeAccessibilityData>;
}

function fakeDeps(): FakeDeps {
  const data = fakeAccessibilityData();
  const currentUser: { value: User | undefined } = { value: undefined };
  const auditLog: AuditEntry[] = [];

  const guardianAccess: GuardianAccessPort = {
    async hasGrantedGuardianAccess() {
      return false;
    },
    async getGuardianLink() {
      return undefined;
    },
  };

  const audit: AuditPort = {
    async record(entry) {
      auditLog.push(entry);
    },
  };

  // Test-only session boundary with the real requireAuth's contract.
  const authenticate: RequestHandler = (req, res, next) => {
    if (currentUser.value) {
      (req as AuthedRequest).user = currentUser.value;
      next();
      return;
    }
    res.status(401).json({ code: "unauthorized", message: "Sign in to continue." });
  };

  return {
    deps: {
      db: () => undefined as never,
      codec: undefined as never,
      // Never exercised here — password hashing belongs to the auth suite.
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
  ttsEnabled?: boolean;
  captionsEnabled?: boolean;
  textSize?: string;
  breakIntervalMinutes?: number;
}

type Result = { status: number; body: JsonBody };

describe("me/accessibility routes (in-memory fakes, GET/PATCH /me/accessibility)", () => {
  let server: http.Server;
  let baseUrl: string;
  let harness: FakeDeps;

  beforeAll(async () => {
    harness = fakeDeps();
    const app: Express = express();
    app.use(express.json());
    app.use("/me", createMeRoutes(harness.deps));
    app.use(errorHandler);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/me`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    harness.currentUser.value = undefined;
    harness.auditLog.length = 0;
    harness.data.rows.clear();
    harness.data.patches.length = 0;
  });

  async function call(method: string, path: string, body?: unknown): Promise<Result> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text || "{}") as JsonBody };
  }

  it("lazily creates product defaults on first read (captions on, TTS off)", async () => {
    harness.currentUser.value = fakeUser();
    const res = await call("GET", "/accessibility");
    expect(res.status).toBe(200);
    expect(res.body.captionsEnabled).toBe(true);
    expect(res.body.ttsEnabled).toBe(false);
    expect(res.body.textSize).toBe("medium");
  });

  it("applies only the fields the caller sent", async () => {
    harness.currentUser.value = fakeUser();
    const res = await call("PATCH", "/accessibility", { textSize: "large", ttsEnabled: true });
    expect(res.status).toBe(200);
    expect(res.body.textSize).toBe("large");
    expect(res.body.ttsEnabled).toBe(true);
    expect(res.body.captionsEnabled).toBe(true); // untouched default
    expect(harness.data.patches[0]?.patch).toEqual({ textSize: "large", ttsEnabled: true });
    expect(
      harness.auditLog.some((e) => e.action === "edit_profile" && e.decision === "allowed"),
    ).toBe(true);
  });

  it("works for any role — no diagnosis gate on preferences", async () => {
    harness.currentUser.value = fakeUser(USER_ID, "parent");
    const res = await call("PATCH", "/accessibility", { highContrast: true });
    expect(res.status).toBe(200);
    expect(res.body.code).toBeUndefined();
  });

  it("rejects out-of-range break intervals at the contract boundary", async () => {
    harness.currentUser.value = fakeUser();
    const res = await call("PATCH", "/accessibility", { breakIntervalMinutes: 999 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_request");
    expect(harness.data.patches).toHaveLength(0);
  });

  it("rejects unknown enum values", async () => {
    harness.currentUser.value = fakeUser();
    const res = await call("PATCH", "/accessibility", { textSize: "gigantic" });
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated access at the boundary", async () => {
    const res = await call("GET", "/accessibility");
    expect(res.status).toBe(401);
  });
});
