// Route tests for the parent dashboard surface (contract: GET
// /parent/students…, spec §6.9). In-memory fakes, no database: the real
// requireAuth/codec and drizzle data layers are covered by the auth and db
// suites; what is proven here is the consent boundary and the view-only
// scope —
//
//   consent gates every view (revoked consent removes access, same turn),
//   a parent sees only linked students' data (cross-family denial),
//   educator/admin/student roles cannot pose as guardians,
//   and the parent scope is read-only: no session starts, no edits,
//   no exports — the session summaries carry no turn content at all.

import express, { type Express, type RequestHandler } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TutoringSession } from "@workspace/api-zod";
import type { User } from "@workspace/db/schema";
import { evaluatePolicy, type GuardianAccessPort } from "../auth/authorize";
import type { AuditEntry, AuditPort } from "../auth/audit";
import type { AuthedRequest } from "../auth/middleware";
import { createParentViewRoutes, type ParentViewDeps } from "./parent-views";
import {
  deriveAtHomeActivities,
  groupMasteryBySubject,
  type ActivityEntryRow,
  type ActivityRecord,
  type ParentViewDataPort,
} from "../parents/parent-views";
import { createSessionRoutes, type SessionDeps } from "../sessions/routes";
import type { SessionDataPort } from "../sessions/session-service";
import { createProfileRoutes, type ProfileDeps } from "./profiles";
import type { ProfileDataPort } from "../profiles/profile-service";
import { createScriptedProvider } from "../tutor/provider/scripted";
import { MasteryLevel, ProfileEntryKind } from "@workspace/api-zod";
import { errorHandler } from "../middlewares/errorHandler";

const STUDENT_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_STUDENT_ID = "00000000-0000-4000-8000-000000000002";
const PARENT_ID = "00000000-0000-4000-8000-000000000003";
const OTHER_PARENT_ID = "00000000-0000-4000-8000-000000000004";
const SESSION_ID = "00000000-0000-4000-8000-000000000005";
// Registered in no fake account store — exercises the no-existence-leak path.
const GHOST_STUDENT_ID = "00000000-0000-4000-8000-0000000000ff";

const NOW = new Date("2026-11-01T10:00:00.000Z");

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

function fakeSessionRow(studentId: string): TutoringSession {
  return {
    id: SESSION_ID,
    studentId,
    title: "Money math practice",
    status: "active",
    startedAt: NOW,
    lastTurnAt: NOW.toISOString(),
    endedAt: null,
    pendingAction: null,
    pendingCheckLine: null,
  };
}

function fakeAssessmentRow(subject: string, level: string, createdAt: Date) {
  return {
    subject,
    level: level as "memorization" | "recognition" | "comprehension" | "application" | "mastery",
    evidenceNote: `Solved a novel ${subject} problem without help`,
    createdAt,
  };
}

function fakeEntry(kind: ActivityEntryRow["kind"], subject: string | null, detail: string): ActivityEntryRow {
  return { id: `entry-${Math.random().toString(36).slice(2)}`, kind, subject, detail };
}

/** Members a 403 must never reach — the authorization layer denies first. */
function unreachable(name: string): () => never {
  return () => {
    throw new Error(`${name} must never be reached by a denied caller`);
  };
}

interface FakeDeps {
  parentDeps: ParentViewDeps;
  currentUser: { value: User | undefined };
  /** The consent authority's in-memory trail: `parentId:studentId` pairs. */
  grantedLinks: Set<string>;
  auditLog: AuditEntry[];
  data: {
    roster: Array<{ student: { id: string; email: string; displayName: string }; linkStatus: "pending" | "granted" | "revoked" }>;
    overviewRequested: string[];
    sessions: Array<{ id: string; title: string | null; status: "active" | "completed"; startedAt: Date; lastTurnAt: string | null; endedAt: string | null; turnCount: number }>;
    sessionsRequested: Array<{ studentId: string; limit: number }>;
    activityRecord: ActivityRecord;
  };
}

function fakeDeps(): FakeDeps {
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

  const authenticate: RequestHandler = (req, res, next) => {
    if (currentUser.value) {
      (req as AuthedRequest).user = currentUser.value;
      next();
      return;
    }
    res.status(401).json({ code: "unauthorized", message: "Sign in to continue." });
  };

  const data = {
    roster: [] as FakeDeps["data"]["roster"],
    overviewRequested: [] as string[],
    sessions: [] as FakeDeps["data"]["sessions"],
    sessionsRequested: [] as FakeDeps["data"]["sessionsRequested"],
    activityRecord: {
      profileSubjects: [],
      entries: [],
      assessmentRows: [],
    } as ActivityRecord,
  };

  const parentViewData: ParentViewDataPort = {
    async listLinkedStudents(parentId) {
      // The roster query is scoped by the caller upstream — a fake returns
      // everything and the policy test catches any caller-scoping drift.
      return data.roster.filter(() => parentId !== "");
    },
    async masteryOverview(studentId) {
      data.overviewRequested.push(studentId);
      return {
        student: { id: STUDENT_ID, email: "student@primer.test", displayName: "Sam" },
        subjects: groupMasteryBySubject(data.activityRecord.assessmentRows),
      };
    },
    async sessionSummaries(studentId, limit) {
      data.sessionsRequested.push({ studentId, limit });
      return data.sessions.slice(0, limit);
    },
    async activityRecord() {
      return data.activityRecord;
    },
  };

  const parentDeps: ParentViewDeps = {
    db: () => undefined as never,
    codec: undefined as never,
    passwords: { hash: async () => "unused", verify: async () => false },
    audit,
    guardianAccess,
    // Parent views never consult educator links — the port is part of the
    // shared AuthDeps shape, so it rides along as an uncalled stub.
    educatorAccess: undefined as never,
    data: parentViewData,
    authenticate,
  };

  return { parentDeps, currentUser, grantedLinks, auditLog, data };
}

interface JsonBody {
  code?: string;
  message?: string;
  students?: Array<{ id: string; displayName: string; linkStatus: string; accessGranted: boolean }>;
  subjects?: Array<{ subject: string; highestLevel: string | null; counts: Record<string, number>; evidenceCount: number }>;
  sessions?: Array<Record<string, unknown>>;
  activities?: Array<{ id: string; title: string; reason: string; subject: string | null }>;
}

type Result = { status: number; body: JsonBody };

function buildApp(harness: FakeDeps): Express {
  const app: Express = express();
  app.use(express.json());

  const sessionDeps: SessionDeps = {
    ...harness.parentDeps,
    provider: createScriptedProvider(),
    assessments: {
      record: unreachable("assessments.record"),
      store: unreachable("assessments.store"),
    } as never,
    // The route layer must deny a parent before the data port is consulted —
    // every member here failing loudly is the proof.
    data: {
      createSession: unreachable("createSession"),
      listSessions: unreachable("listSessions"),
      getSession: async (sessionId) =>
        sessionId === SESSION_ID ? fakeSessionRow(STUDENT_ID) : undefined,
      deleteSession: unreachable("deleteSession"),
      listTurns: unreachable("listTurns"),
      appendTurns: unreachable("appendTurns"),
      setPending: unreachable("setPending"),
      consumePending: unreachable("consumePending"),
      insertMaterial: unreachable("insertMaterial"),
      listMaterials: unreachable("listMaterials"),
      listMaterialContents: unreachable("listMaterialContents"),
      completeSession: unreachable("completeSession"),
    } as SessionDataPort,
  };

  const profileDeps: ProfileDeps = {
    ...harness.parentDeps,
    data: {
      studentExists: unreachable("studentExists"),
      ensureProfile: unreachable("ensureProfile"),
      updateProfile: unreachable("updateProfile"),
      createProfileEntry: unreachable("createProfileEntry"),
      listProfileEntries: unreachable("listProfileEntries"),
      deleteProfileEntry: unreachable("deleteProfileEntry"),
    } as ProfileDataPort,
  };

  app.use("/parent", createParentViewRoutes(harness.parentDeps));
  app.use("/sessions", createSessionRoutes(sessionDeps));
  app.use("/profiles", createProfileRoutes(profileDeps));
  // Same boundary as the real app: typed auth errors become 401/403 JSON.
  app.use(errorHandler);
  return app;
}

describe("parent-view routes (in-memory fakes, contract GET /parent/students…)", () => {
  let server: http.Server;
  let baseUrl: string;
  let harness: FakeDeps;

  beforeAll(async () => {
    harness = fakeDeps();
    server = http.createServer(buildApp(harness));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
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
    harness.data.roster.length = 0;
    harness.data.overviewRequested.length = 0;
    harness.data.sessions.length = 0;
    harness.data.sessionsRequested.length = 0;
    harness.data.activityRecord = { profileSubjects: [], entries: [], assessmentRows: [] };
  });

  async function call(method: string, path: string, body?: unknown): Promise<Result> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : {}) as JsonBody };
  }

  function asUser(id: string, role: User["role"]): void {
    harness.currentUser.value = fakeUser(id, role);
  }

  function grantConsent(parentId: string, studentId: string): void {
    harness.grantedLinks.add(`${parentId}:${studentId}`);
  }

  // ── The roster ─────────────────────────────────────────────────────────────

  it("lists the caller's linked students with honest access state", async () => {
    asUser(PARENT_ID, "parent");
    harness.data.roster.push(
      { student: { id: STUDENT_ID, email: "sam@primer.test", displayName: "Sam" }, linkStatus: "granted" },
      { student: { id: OTHER_STUDENT_ID, email: "ale@primer.test", displayName: "Alex" }, linkStatus: "pending" },
    );
    grantConsent(PARENT_ID, STUDENT_ID);

    const res = await call("GET", "/parent/students");
    expect(res.status).toBe(200);
    const granted = res.body.students?.find((s) => s.id === STUDENT_ID);
    const pending = res.body.students?.find((s) => s.id === OTHER_STUDENT_ID);
    expect(granted).toMatchObject({ displayName: "Sam", linkStatus: "granted", accessGranted: true });
    // A pending link is listed honestly — and grants nothing.
    expect(pending).toMatchObject({ linkStatus: "pending", accessGranted: false });
  });

  // ── Consent enforcement ────────────────────────────────────────────────────

  it("serves the mastery overview to a consented parent, evidence-backed only", async () => {
    asUser(PARENT_ID, "parent");
    grantConsent(PARENT_ID, STUDENT_ID);
    harness.data.activityRecord.assessmentRows.push(
      fakeAssessmentRow("Money math", MasteryLevel.comprehension, new Date("2026-10-30T10:00:00Z")),
      fakeAssessmentRow("Money math", MasteryLevel.recognition, new Date("2026-10-29T10:00:00Z")),
    );

    const res = await call("GET", `/parent/students/${STUDENT_ID}/mastery`);
    expect(res.status).toBe(200);
    expect(res.body.subjects).toHaveLength(1);
    const subject = res.body.subjects?.[0];
    expect(subject).toMatchObject({
      subject: "Money math",
      highestLevel: "comprehension",
      evidenceCount: 2,
    });
    expect(subject?.counts).toMatchObject({ comprehension: 1, recognition: 1 });
    expect(
      harness.auditLog.some((e) => e.decision === "allowed" && e.authorizationEvidence.hasGuardianAccess === true),
    ).toBe(true);
  });

  it("removes access the moment consent is revoked", async () => {
    asUser(PARENT_ID, "parent");
    grantConsent(PARENT_ID, STUDENT_ID);
    harness.data.activityRecord.assessmentRows.push(
      fakeAssessmentRow("Money math", MasteryLevel.comprehension, NOW),
    );
    expect((await call("GET", `/parent/students/${STUDENT_ID}/mastery`)).status).toBe(200);

    // The guardian revokes — the consent trail is the authority.
    harness.grantedLinks.delete(`${PARENT_ID}:${STUDENT_ID}`);
    const revoked = await call("GET", `/parent/students/${STUDENT_ID}/mastery`);
    expect(revoked.status).toBe(403);
    expect(revoked.body.code).toBe("forbidden");
    expect(harness.auditLog.some((e) => e.decision === "denied")).toBe(true);
  });

  it("denies a parent whose link was never consented (pending)", async () => {
    asUser(PARENT_ID, "parent");
    const res = await call("GET", `/parent/students/${STUDENT_ID}/mastery`);
    expect(res.status).toBe(403);
    expect(harness.data.overviewRequested).toHaveLength(0);
  });

  it("denies cross-family access — a parent sees only linked students", async () => {
    asUser(OTHER_PARENT_ID, "parent");
    grantConsent(OTHER_PARENT_ID, OTHER_STUDENT_ID);
    const res = await call("GET", `/parent/students/${STUDENT_ID}/sessions`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("forbidden");
    expect(harness.data.sessionsRequested).toHaveLength(0);
  });

  it("does not leak existence: an unlinked student id reads as forbidden", async () => {
    asUser(PARENT_ID, "parent");
    const res = await call("GET", `/parent/students/${GHOST_STUDENT_ID}/mastery`);
    expect(res.status).toBe(403);
    expect(harness.data.overviewRequested).toHaveLength(0);
  });

  // ── Role gates: nobody poses as a guardian ────────────────────────────────

  it("rejects educator, admin, and student callers on the parent surface", async () => {
    for (const [id, role] of [
      ["edu-1", "educator"],
      ["adm-1", "admin"],
      [STUDENT_ID, "student"],
    ] as const) {
      harness.currentUser.value = fakeUser(id, role);
      const res = await call("GET", "/parent/students");
      expect(res.status, role).toBe(403);
      expect(harness.auditLog.some((e) => e.decision === "denied")).toBe(true);
    }
  });

  it("rejects unauthenticated callers at the boundary", async () => {
    const res = await call("GET", "/parent/students");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("unauthorized");
  });

  // ── Session summaries: metadata only, never transcripts ───────────────────

  it("returns session summaries whose shape carries no turn content", async () => {
    asUser(PARENT_ID, "parent");
    grantConsent(PARENT_ID, STUDENT_ID);
    harness.data.sessions.push({
      id: SESSION_ID,
      title: "Money math practice",
      status: "active",
      startedAt: NOW,
      lastTurnAt: NOW.toISOString(),
      endedAt: null,
      turnCount: 7,
    });

    const res = await call("GET", `/parent/students/${STUDENT_ID}/sessions`);
    expect(res.status).toBe(200);
    const summary = res.body.sessions?.[0];
    expect(summary).toMatchObject({ id: SESSION_ID, turnCount: 7, status: "active" });
    // The no-transcript property, pinned on the wire shape: exactly these
    // keys — no `content`, no `turns`, nothing that renders a conversation.
    expect(Object.keys(summary ?? {}).sort()).toEqual(
      ["endedAt", "id", "lastTurnAt", "startedAt", "status", "title", "turnCount"].sort(),
    );
  });

  it("validates the sessions limit against the contract", async () => {
    asUser(PARENT_ID, "parent");
    grantConsent(PARENT_ID, STUDENT_ID);

    expect((await call("GET", `/parent/students/${STUDENT_ID}/sessions?limit=500`)).status).toBe(400);

    const ok = await call("GET", `/parent/students/${STUDENT_ID}/sessions?limit=5`);
    expect(ok.status).toBe(200);
    expect(harness.data.sessionsRequested[0]).toMatchObject({ studentId: STUDENT_ID, limit: 5 });
  });

  // ── At-home activities: derived from the record, inert ────────────────────

  it("derives at-home activities that quote the motivating record", async () => {
    asUser(PARENT_ID, "parent");
    grantConsent(PARENT_ID, STUDENT_ID);
    harness.data.activityRecord.entries.push(
      fakeEntry(ProfileEntryKind.gap, "Fractions", "Struggled to compare unlike denominators twice"),
    );
    harness.data.activityRecord.profileSubjects.push("Fractions", "Geometry");

    const res = await call("GET", `/parent/students/${STUDENT_ID}/activities`);
    expect(res.status).toBe(200);
    const activities = res.body.activities ?? [];
    expect(activities.some((a) => a.id.startsWith("home-practice-"))).toBe(true);
    const practice = activities.find((a) => a.title === "Practice together: Fractions");
    expect(practice?.reason).toBe("Struggled to compare unlike denominators twice");
    // Chosen but unexplored subjects get an honest first step.
    expect(activities.some((a) => a.title === "Start exploring: Geometry")).toBe(true);
  });

  it("denies activities without consent", async () => {
    asUser(PARENT_ID, "parent");
    const res = await call("GET", `/parent/students/${STUDENT_ID}/activities`);
    expect(res.status).toBe(403);
  });

  // ── Parent scope: view-only, everywhere ───────────────────────────────────

  it("blocks a consented parent from starting a student session", async () => {
    asUser(PARENT_ID, "parent");
    grantConsent(PARENT_ID, STUDENT_ID);
    const res = await call("POST", "/sessions", {});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("forbidden");
  });

  it("blocks a consented parent from editing the student's profile", async () => {
    asUser(PARENT_ID, "parent");
    grantConsent(PARENT_ID, STUDENT_ID);
    const res = await call("PATCH", `/profiles/${STUDENT_ID}`, { subjects: ["Money math"] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("forbidden");
  });

  it("blocks a consented parent from writing profile entries", async () => {
    asUser(PARENT_ID, "parent");
    grantConsent(PARENT_ID, STUDENT_ID);
    // A governance-valid entry (cited evidence included) — the write is still
    // refused: the learning record is never a parent's to author.
    const res = await call("POST", `/profiles/${STUDENT_ID}/entries`, {
      kind: "gap",
      subject: "Money math",
      detail: "Added by a parent — must never land",
      sourceAssessmentId: "00000000-0000-4000-8000-0000000000aa",
    });
    expect(res.status).toBe(403);
  });

  it("blocks a consented parent from deleting a student session", async () => {
    asUser(PARENT_ID, "parent");
    grantConsent(PARENT_ID, STUDENT_ID);
    const res = await call("DELETE", `/sessions/${SESSION_ID}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("forbidden");
  });

  it("blocks exports at the policy layer — a parent never exports child data", () => {
    // export_data has no parent route by design; the decision table is the
    // boundary that keeps it that way. Pinned here so a future policy edit
    // that grants it fails loudly.
    expect(
      evaluatePolicy(
        { id: PARENT_ID, role: "parent" },
        "export_data",
        { type: "user_data", userId: STUDENT_ID },
        { isSelf: false, hasGuardianAccess: true, isLinkOwner: false },
      ),
    ).toBe("deny");
    expect(
      evaluatePolicy(
        { id: "edu-1", role: "educator" },
        "export_data",
        { type: "user_data", userId: STUDENT_ID },
        { isSelf: false, hasGuardianAccess: true, isLinkOwner: false },
      ),
    ).toBe("deny");
    expect(
      evaluatePolicy(
        { id: "adm-1", role: "admin" },
        "edit_profile",
        { type: "user_data", userId: STUDENT_ID },
        { isSelf: false, hasGuardianAccess: true, isLinkOwner: false },
      ),
    ).toBe("deny");
  });
});

// ── The pure derivations, directly ──────────────────────────────────────────

describe("parent-view derivations", () => {
  it("summarizes mastery per subject from evidence rows only", () => {
    const overview = groupMasteryBySubject([
      fakeAssessmentRow("B", MasteryLevel.application, new Date("2026-10-30T10:00:00Z")),
      fakeAssessmentRow("A", MasteryLevel.recognition, new Date("2026-10-29T10:00:00Z")),
      fakeAssessmentRow("A", MasteryLevel.memorization, new Date("2026-10-28T10:00:00Z")),
    ]);
    expect(overview.map((s) => s.subject)).toEqual(["A", "B"]);
    expect(overview[0]).toMatchObject({ highestLevel: "recognition", evidenceCount: 2 });
    expect(overview[0]?.lastEvidenceAt).toEqual(new Date("2026-10-29T10:00:00.000Z"));
    expect(overview[1]).toMatchObject({ highestLevel: "application", evidenceCount: 1 });
  });

  it("reports no level for a subject with no evidence", () => {
    const overview = groupMasteryBySubject([]);
    expect(overview).toEqual([]);
  });

  it("derives stretch activities only for application-or-better evidence", () => {
    const record: ActivityRecord = {
      profileSubjects: [],
      entries: [],
      assessmentRows: [
        fakeAssessmentRow("Money math", MasteryLevel.mastery, NOW),
        fakeAssessmentRow("Fractions", MasteryLevel.comprehension, NOW),
      ],
    };
    const activities = deriveAtHomeActivities(record);
    expect(activities.map((a) => a.title)).toEqual(["Keep stretching: Money math"]);
  });

  it("caps the activity list at six suggestions", () => {
    const record: ActivityRecord = {
      profileSubjects: ["S1", "S2", "S3", "S4", "S5", "S6", "S7"],
      entries: [],
      assessmentRows: [],
    };
    expect(deriveAtHomeActivities(record)).toHaveLength(6);
  });
});
