// Route tests for the progress-timeline endpoint (contract: GET
// /progress/{studentId}; spec §6.7, §6.9). The progress data port, guardian
// access, and audit run as in-memory fakes and the session boundary is
// substituted — the real requireAuth/codec and the drizzle data layer are
// covered by the auth and db suites; what is proven here is the read policy
// (self or consented parent, nothing else) and the contract shapes at the
// API boundary. No database, so they run everywhere.

import express, { type Express, type RequestHandler } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProgressEvent, User } from "@workspace/db/schema";
import type { GuardianAccessPort } from "../auth/authorize";
import type { AuditEntry, AuditPort } from "../auth/audit";
import type { AuthedRequest } from "../auth/middleware";
import { createProgressRoutes, type ProgressDeps } from "./progress";
import type { ProgressDataPort, ProgressQuery } from "../progress/progress-service";
import { errorHandler } from "../middlewares/errorHandler";

const STUDENT_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_STUDENT_ID = "00000000-0000-4000-8000-000000000002";
const PARENT_ID = "00000000-0000-4000-8000-000000000003";
// Registered in no fake account store — exercises the 404 path.
const GHOST_STUDENT_ID = "00000000-0000-4000-8000-0000000000ff";

const NOW = new Date("2026-11-01T10:00:00.000Z");

let eventCounter = 0;
function fakeEvent(studentId: string, kind: ProgressEvent["kind"]): ProgressEvent {
  eventCounter += 1;
  return {
    id: `00000000-0000-4000-8000-${eventCounter.toString(16).padStart(12, "0")}`,
    studentId,
    actorId: null,
    sessionId: null,
    kind,
    summary: `${kind} happened`,
    payload: { level: "comprehension" },
    createdAt: NOW,
  };
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

/** In-memory ProgressDataPort — records the queries the routes issued. */
function fakeProgressData() {
  const students = new Set<string>([STUDENT_ID, OTHER_STUDENT_ID]);
  const events: ProgressEvent[] = [];
  const queries: Array<{ studentId: string; query: ProgressQuery }> = [];

  const port: ProgressDataPort = {
    async studentExists(studentId) {
      return students.has(studentId);
    },
    async listProgressEvents(studentId, query) {
      queries.push({ studentId, query });
      return events
        .filter((e) => e.studentId === studentId)
        .filter((e) => query.kind === undefined || e.kind === query.kind)
        .slice(0, query.limit);
    },
  };

  return { port, students, events, queries };
}

interface FakeDeps {
  deps: ProgressDeps;
  currentUser: { value: User | undefined };
  grantedLinks: Set<string>;
  auditLog: AuditEntry[];
  data: ReturnType<typeof fakeProgressData>;
}

function fakeDeps(): FakeDeps {
  const data = fakeProgressData();
  const currentUser: { value: User | undefined } = { value: undefined };
  const grantedLinks = new Set<string>();
  const auditLog: AuditEntry[] = [];

  const guardianAccess: GuardianAccessPort = {
    async hasGrantedGuardianAccess(parentId, studentId) {
      return grantedLinks.has(`${parentId}:${studentId}`);
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

  // Test-only session boundary with the real requireAuth's contract: no user,
  // no pass-through (the real one is covered by the auth suite).
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
      // Educator paths are not exercised here; the deny stub keeps the
      // fail-closed default visible in the fixture.
      educatorAccess: {
        hasActiveEducatorLink: async () => false,
        getEducatorLink: async () => undefined,
      },
      data: data.port,
      authenticate,
    },
    currentUser,
    grantedLinks,
    auditLog,
    data,
  };
}

interface JsonBody {
  code?: string;
  events?: Array<{ id: string; kind: string; summary: string; payload: Record<string, unknown> }>;
}

type Result = { status: number; body: JsonBody };

describe("progress routes (in-memory fakes, contract GET /progress/{studentId})", () => {
  let server: http.Server;
  let baseUrl: string;
  let harness: FakeDeps;

  beforeAll(async () => {
    harness = fakeDeps();
    const app: Express = express();
    app.use(express.json());
    app.use("/progress", createProgressRoutes(harness.deps));
    // Same boundary as the real app: typed auth errors become 401/403 JSON.
    app.use(errorHandler);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/progress`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    // In-memory fakes are shared by every request in this file — reset state
    // so tests stay order-independent.
    harness.currentUser.value = undefined;
    harness.grantedLinks.clear();
    harness.auditLog.length = 0;
    harness.data.events.length = 0;
    harness.data.queries.length = 0;
  });

  async function call(method: string, path: string): Promise<Result> {
    const res = await fetch(`${baseUrl}${path}`, { method });
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text || "{}") as JsonBody };
  }

  function asStudent(id = STUDENT_ID) {
    harness.currentUser.value = fakeUser(id, "student");
  }

  function asParent(id = PARENT_ID) {
    harness.currentUser.value = fakeUser(id, "parent");
  }

  it("returns the student's own timeline with contract shapes", async () => {
    asStudent();
    harness.data.events.push(
      fakeEvent(STUDENT_ID, "assessment_recorded"),
      fakeEvent(STUDENT_ID, "strategy_changed"),
    );
    const res = await call("GET", `/${STUDENT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(2);
    expect(res.body.events?.[0]?.kind).toBe("assessment_recorded");
    expect(res.body.events?.[0]?.payload).toMatchObject({ level: "comprehension" });
    expect(
      harness.auditLog.some((e) => e.action === "view_progress" && e.decision === "allowed"),
    ).toBe(true);
  });

  it("lets a parent with granted consent read the timeline (view only)", async () => {
    asParent();
    harness.grantedLinks.add(`${PARENT_ID}:${STUDENT_ID}`);
    harness.data.events.push(fakeEvent(STUDENT_ID, "mastery_changed"));
    const res = await call("GET", `/${STUDENT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(
      harness.auditLog.some(
        (e) => e.decision === "allowed" && e.authorizationEvidence.hasGuardianAccess === true,
      ),
    ).toBe(true);
  });

  it("denies a parent without a granted consent link", async () => {
    asParent();
    const res = await call("GET", `/${STUDENT_ID}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("forbidden");
    expect(harness.auditLog.some((e) => e.decision === "denied")).toBe(true);
  });

  it("denies a student another student's timeline", async () => {
    asStudent();
    const res = await call("GET", `/${OTHER_STUDENT_ID}`);
    expect(res.status).toBe(403);
    expect(harness.auditLog.some((e) => e.decision === "denied")).toBe(true);
  });

  it("does not leak existence: an unknown student id reads as forbidden", async () => {
    // The policy checks ownership/consent first, so a ghost student looks
    // exactly like someone else's timeline — no enumeration oracle.
    asStudent();
    const res = await call("GET", `/${GHOST_STUDENT_ID}`);
    expect(res.status).toBe(403);
    expect(harness.auditLog.some((e) => e.decision === "denied")).toBe(true);
  });

  it("validates the path id and query against the contract", async () => {
    asStudent();
    const badId = await call("GET", "/not-a-uuid");
    expect(badId.status).toBe(400);

    const badLimit = await call("GET", `/${STUDENT_ID}?limit=500`);
    expect(badLimit.status).toBe(400);

    const badKind = await call("GET", `/${STUDENT_ID}?kind=vibes`);
    expect(badKind.status).toBe(400);
  });

  it("passes validated kind/since/limit filters through to the port", async () => {
    asStudent();
    const since = "2026-10-01T00:00:00.000Z";
    const res = await call(
      "GET",
      `/${STUDENT_ID}?kind=milestone_reached&since=${encodeURIComponent(since)}&limit=5`,
    );
    expect(res.status).toBe(200);
    expect(harness.data.queries[0]?.studentId).toBe(STUDENT_ID);
    expect(harness.data.queries[0]?.query).toMatchObject({
      kind: "milestone_reached",
      since: new Date(since),
      limit: 5,
    });
  });

  it("applies the contract default limit (50) when none is sent", async () => {
    asStudent();
    await call("GET", `/${STUDENT_ID}`);
    expect(harness.data.queries[0]?.query.limit).toBe(50);
  });

  it("rejects unauthenticated reads at the boundary", async () => {
    const res = await call("GET", `/${STUDENT_ID}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("unauthorized");
    expect(harness.data.queries).toHaveLength(0);
  });
});
