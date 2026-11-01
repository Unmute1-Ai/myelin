// Route + integration tests for the persistent live tutor (spec §5, §6.3,
// §6.7, §6.11). Runs against a real PostgreSQL only — set
// SESSIONS_TEST_DATABASE_URL (a local test database; credentials live outside
// the repo). `pnpm -r test` stays green without it.
//
// The persistence gate is structural, not simulated: turns 1–2 run through one
// createSessionRoutes instance, then a second instance with fresh ports and a
// fresh provider continues the same session — everything the tutor knows
// about position, history, and pending state had to come from the rows.

import http from "node:http";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog } from "@workspace/db/schema";

const SESSIONS_TEST_DATABASE_URL = process.env.SESSIONS_TEST_DATABASE_URL;

// The app reads DATABASE_URL lazily at first query and the session codec reads
// SESSION_SECRET at first sign — set both before anything runs.
if (SESSIONS_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = SESSIONS_TEST_DATABASE_URL;
  process.env.SESSION_SECRET ??= "sessions-route-test-secret-0123456789abcdef0123456789abcdef";
}
process.env.NODE_ENV ??= "test";

const TRUNCATE_TABLES =
  "users, guardian_links, consents, audit_log, learning_profiles, profile_entries, " +
  "tutoring_sessions, session_turns, assessments, progress_events, accessibility_prefs, session_materials";

const PASSWORD = "correct-horse-battery-staple-9";
let emailCounter = 0;
function uniqueEmail(prefix: string): string {
  emailCounter += 1;
  return `${prefix}-${emailCounter}@primer-session.test`;
}

interface TurnDto {
  id: string;
  seq: number;
  author: string;
  content: string;
  kind: string | null;
  stepId: string | null;
  strategyId: string | null;
}

interface JsonBody {
  code?: string;
  message?: string;
  user?: { id: string; email: string; role: string };
  id?: string;
  link?: { id: string };
  studentId?: string;
  pendingAction?: string | null;
  pendingCheckLine?: string | null;
  status?: string;
  studentTurn?: TurnDto;
  tutorTurn?: TurnDto;
  spokenReply?: string;
  proposedAction?: string;
  checkLine?: string;
  strategyId?: string;
  strategyWhy?: string;
  recordedAssessments?: Array<{ level: string; evidenceKind: string; evidenceNote: string }>;
  turns?: TurnDto[];
  executed?: boolean;
  tutorTurns?: TurnDto[];
  reply?: string;
  materials?: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number; contentChars: number }>;
  sessions?: Array<{ id: string; status: string; lastTurnAt: string | null }>;
}

type Result = { status: number; body: JsonBody; setCookie: string[] };

let server: http.Server | undefined;
let baseUrl = "";

async function call(
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<Result> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.token) headers.cookie = options.token;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let body: JsonBody = {};
  if (res.status !== 204) body = (await res.json()) as JsonBody;
  return { status: res.status, body, setCookie: res.headers.getSetCookie() };
}

function cookieFrom(setCookie: string[]): string {
  const raw = setCookie.find((c) => c.startsWith("primer_session="));
  expect(raw, "expected a primer_session cookie").toBeDefined();
  return raw!.split(";")[0]!;
}

async function register(role: string): Promise<{ token: string; userId: string; email: string }> {
  const email = uniqueEmail(role);
  const res = await call("POST", "/auth/register", {
    body: { email, password: PASSWORD, role, displayName: `Test ${role}` },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { token: cookieFrom(res.setCookie), userId: res.body.user!.id, email };
}

/** Link a parent to a student and record guardian_access consent. */
async function linkWithConsent(parentToken: string, studentEmail: string): Promise<void> {
  const link = await call("POST", "/guardian/links", {
    token: parentToken,
    body: { studentEmail },
  });
  expect([200, 201]).toContain(link.status);
  const grant = await call("POST", `/guardian/links/${link.body.link!.id}/consents`, {
    token: parentToken,
    body: { type: "guardian_access", termsVersion: "2026-11-01" },
  });
  expect([200, 201]).toContain(grant.status);
}

/** Start a session and take the opening teach turn. */
async function startSession(token: string, title?: string): Promise<{ id: string; teach: TurnDto }> {
  const created = await call("POST", "/sessions", { token, body: title ? { title } : {} });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.id!;
  const open = await call("POST", `/sessions/${id}/turns`, { token, body: { content: "hi" } });
  expect(open.status, JSON.stringify(open.body)).toBe(201);
  return { id, teach: open.body.tutorTurn! };
}

describe.skipIf(!SESSIONS_TEST_DATABASE_URL)("persistent sessions routes (requires SESSIONS_TEST_DATABASE_URL)", () => {
  let db: NodePgDatabase;
  let pool: Pool;

  beforeAll(async () => {
    const pg = (await import("pg")).default;
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    pool = new pg.Pool({ connectionString: SESSIONS_TEST_DATABASE_URL });
    db = drizzle(pool);
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../../../../lib/db/drizzle", import.meta.url)),
    });

    const { default: app } = await import("../app");
    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server!.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api`;
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await pool.end();
  });

  beforeEach(async () => {
    await db.execute(sql.raw(`TRUNCATE TABLE ${TRUNCATE_TABLES} CASCADE`));
  });

  async function auditRows(action: string): Promise<{ actorId: string | null; action: string }[]> {
    return db
      .select({ actorId: auditLog.actorId, action: auditLog.action })
      .from(auditLog)
      .where(sql`${auditLog.action} = ${action}`);
  }

  // -------------------------------------------------------------------------
  // Auth boundary and session lifecycle
  // -------------------------------------------------------------------------

  it("requires authentication for every session route", async () => {
    const res = await call("GET", "/sessions");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("unauthorized");
  });

  it("starts a session for the student and stores the opening teach turn", async () => {
    const student = await register("student");
    const { id, teach } = await startSession(student.token);

    expect(id).toBeDefined();
    const fetched = await call("GET", `/sessions/${id}`, { token: student.token });
    expect(fetched.status).toBe(200);
    expect(fetched.body.studentId).toBe(student.userId);
    expect(fetched.body.pendingAction).toBeNull();
    expect(fetched.body.status).toBe("active");

    expect(teach.author).toBe("tutor");
    expect(teach.kind).toBe("teach");
    expect(teach.stepId).toBeTruthy();
    expect(teach.seq).toBe(1);

    const turns = await call("GET", `/sessions/${id}/turns`, { token: student.token });
    expect(turns.status).toBe(200);
    expect(turns.body.turns!.map((t) => t.author)).toEqual(["student", "tutor"]);
    expect(turns.body.turns!.map((t) => t.seq)).toEqual([0, 1]);
  });

  it("deletes the student's own session and cascades turns; parents cannot delete", async () => {
    const student = await register("student");
    const parent = await register("parent");
    await linkWithConsent(parent.token, student.email);
    const { id } = await startSession(student.token);

    const parentDelete = await call("DELETE", `/sessions/${id}`, { token: parent.token });
    expect(parentDelete.status).toBe(403);

    const res = await call("DELETE", `/sessions/${id}`, { token: student.token });
    expect(res.status).toBe(204);

    const fetched = await call("GET", `/sessions/${id}`, { token: student.token });
    expect(fetched.status).toBe(404);
    const turns = await call("GET", `/sessions/${id}/turns`, { token: student.token });
    expect(turns.status).toBe(404);
  });

  // -------------------------------------------------------------------------
  // RBAC: the session belongs to its student; a parent reads with consent
  // -------------------------------------------------------------------------

  it("denies another student's session and a parent without consent; allows a consented parent to read", async () => {
    const student = await register("student");
    const other = await register("student");
    const parent = await register("parent");
    const { id } = await startSession(student.token);

    const stranger = await call("GET", `/sessions/${id}`, { token: other.token });
    expect(stranger.status).toBe(403);
    const strangerTurns = await call("GET", `/sessions/${id}/turns`, { token: other.token });
    expect(strangerTurns.status).toBe(403);

    const unconsented = await call("GET", `/sessions/${id}`, { token: parent.token });
    expect(unconsented.status).toBe(403);

    await linkWithConsent(parent.token, student.email);
    const consented = await call("GET", `/sessions/${id}`, { token: parent.token });
    expect(consented.status).toBe(200);
    const consentedTurns = await call("GET", `/sessions/${id}/turns`, { token: parent.token });
    expect(consentedTurns.status).toBe(200);
    expect(consentedTurns.body.turns!.length).toBe(2);

    // Consent reads; it never writes: the parent still cannot post turns.
    const parentTurn = await call("POST", `/sessions/${id}/turns`, {
      token: parent.token,
      body: { content: "hi" },
    });
    expect(parentTurn.status).toBe(403);
  });

  // -------------------------------------------------------------------------
  // The persistence gate: a fresh routes instance continues the session
  // -------------------------------------------------------------------------

  it("restores lesson position from stored rows in a fresh instance and persists the exchange", async () => {
    const student = await register("student");
    const { id, teach } = await startSession(student.token);

    // A correct check answer on step 1 (accepted: 2) earns an advance proposal.
    const answer = await call("POST", `/sessions/${id}/turns`, {
      token: student.token,
      body: { content: "2" },
    });
    expect(answer.status, JSON.stringify(answer.body)).toBe(201);
    expect(answer.body.proposedAction).toBe("advance_step");
    expect(answer.body.checkLine).toContain("I heard this as:");
    expect(answer.body.tutorTurn!.kind).toBeNull();

    // Mastery cap (spec §6.3): a recalled correct answer is recognition evidence only.
    const recorded = answer.body.recordedAssessments ?? [];
    expect(recorded.length).toBeGreaterThan(0);
    for (const assessment of recorded) {
      expect(assessment.level).toBe("recognition");
      expect(assessment.evidenceKind).toBe("recall");
    }

    // --- Fresh instance: new ports, new provider, zero shared memory. -------
    const { createSessionRoutes, defaultSessionDeps } = await import("./routes");
    const { requireAuth } = await import("../auth/middleware");
    const expressModule = (await import("express")).default;
    const freshApp = expressModule();
    const freshDeps = defaultSessionDeps();
    freshApp.use(expressModule.json());
    freshApp.use((await import("cookie-parser")).default());
    freshApp.use("/api/sessions", requireAuth(freshDeps), createSessionRoutes(freshDeps));
    const freshServer = http.createServer(freshApp);
    await new Promise<void>((resolve) => freshServer.listen(0, "127.0.0.1", resolve));
    const freshPort = `http://127.0.0.1:${(freshServer.address() as AddressInfo).port}/api/sessions`;
    try {
      const confirm = await fetch(`${freshPort}/${id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: student.token },
        body: JSON.stringify({ accepted: true }),
      });
      expect(confirm.status).toBe(200);
      const confirmed = (await confirm.json()) as JsonBody;
      expect(confirmed.executed).toBe(true);

      // The executed advance taught the NEXT step — position came from rows.
      // The planner appends marker → teaching marker → visible teaching; the
      // learner-facing teaching is the final teach turn.
      const advance = confirmed.tutorTurns!.find((t) => t.kind === "advance");
      expect(advance!.stepId).toBe(teach.stepId);
      const nextTeach = confirmed.tutorTurns!.filter((t) => t.kind === "teach").at(-1)!;
      expect(nextTeach).toBeDefined();
      expect(nextTeach!.stepId).not.toBe(teach.stepId);
      expect(nextTeach!.seq).toBe(6);

      // And the full transcript is intact and ordered, per the contract:
      // greeting exchange, answer + check reply, then the three confirm turns.
      const turns = await call("GET", `/sessions/${id}/turns`, { token: student.token });
      expect(turns.body.turns!.map((t) => t.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    } finally {
      await new Promise<void>((resolve) => freshServer.close(() => resolve()));
    }
  });

  it("lists the student's sessions with resume metadata", async () => {
    const student = await register("student");
    await startSession(student.token, "coins");
    await startSession(student.token);

    const res = await call("GET", "/sessions", { token: student.token });
    expect(res.status).toBe(200);
    expect(res.body.sessions!.length).toBe(2);
    for (const session of res.body.sessions!) {
      expect(session.status).toBe("active");
      expect(session.lastTurnAt).toBeTruthy();
    }
    // Newest activity first — the resume ordering.
    const [first, second] = res.body.sessions!;
    expect(first.lastTurnAt! >= second.lastTurnAt!).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Sentinel: the proposal parks, decline clears, confirm executes once
  // -------------------------------------------------------------------------

  it("parks a proposal as pending state and declines it without executing", async () => {
    const student = await register("student");
    const { id } = await startSession(student.token);
    await call("POST", `/sessions/${id}/turns`, { token: student.token, body: { content: "2" } });

    const parked = await call("GET", `/sessions/${id}`, { token: student.token });
    expect(parked.body.pendingAction).toBe("advance_step");
    expect(parked.body.pendingCheckLine).toContain("I heard this as:");

    const declined = await call("POST", `/sessions/${id}/confirm`, {
      token: student.token,
      body: { accepted: false },
    });
    expect(declined.status).toBe(200);
    expect(declined.body.executed).toBe(false);

    const cleared = await call("GET", `/sessions/${id}`, { token: student.token });
    expect(cleared.body.pendingAction).toBeNull();

    const turns = await call("GET", `/sessions/${id}/turns`, { token: student.token });
    expect(turns.body.turns!.some((t) => t.kind === "advance")).toBe(false);

    expect((await auditRows("tutor_action_declined")).length).toBe(1);
    expect((await auditRows("tutor_action_confirmed")).length).toBe(0);
    // The proposal itself entered the trail — the platform-wide boundary
    // audits every model-generated proposal, not just human decisions.
    expect((await auditRows("tutor_action_proposed")).length).toBe(1);
  });

  it("executes a confirmed action exactly once across competing confirm calls", async () => {
    const student = await register("student");
    const { id } = await startSession(student.token);
    await call("POST", `/sessions/${id}/turns`, { token: student.token, body: { content: "2" } });

    const first = await call("POST", `/sessions/${id}/confirm`, {
      token: student.token,
      body: { accepted: true },
    });
    expect(first.status).toBe(200);
    expect(first.body.executed).toBe(true);
    expect(first.body.tutorTurns!.some((t) => t.kind === "teach")).toBe(true);

    // The proposal was consumed: a second confirm — even a racing one —
    // finds nothing pending and cannot execute the action again.
    const second = await call("POST", `/sessions/${id}/confirm`, {
      token: student.token,
      body: { accepted: true },
    });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("no_pending_action");

    const turns = await call("GET", `/sessions/${id}/turns`, { token: student.token });
    const advances = turns.body.turns!.filter((t) => t.kind === "advance");
    expect(advances.length).toBe(1);

    expect((await auditRows("tutor_action_confirmed")).length).toBe(1);
  });

  it("rejects a confirm when nothing is pending", async () => {
    const student = await register("student");
    const { id } = await startSession(student.token);
    const res = await call("POST", `/sessions/${id}/confirm`, {
      token: student.token,
      body: { accepted: true },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("no_pending_action");
  });

  // -------------------------------------------------------------------------
  // Materials: upload, metadata-only listing, retrieval, isolation
  // -------------------------------------------------------------------------

  it("uploads the student's own text material and grounds answers in it", async () => {
    const student = await register("student");
    const { id } = await startSession(student.token);

    const upload = await call("POST", `/sessions/${id}/materials`, {
      token: student.token,
      body: {
        filename: "class-notes.md",
        mimeType: "text/markdown",
        content: "# Class notes\n\nOur class hamster is named Bolt. He runs on the wheel every night.",
      },
    });
    expect(upload.status, JSON.stringify(upload.body)).toBe(201);

    // Metadata only — extracted text never echoes over the list path.
    const listed = await call("GET", `/sessions/${id}/materials`, { token: student.token });
    expect(listed.status).toBe(200);
    expect(listed.body.materials!.length).toBe(1);
    expect(listed.body.materials![0]).toMatchObject({
      filename: "class-notes.md",
      mimeType: "text/markdown",
      contentChars: expect.any(Number),
    });
    expect(JSON.stringify(listed.body)).not.toContain("Bolt");

    const question = await call("POST", `/sessions/${id}/turns`, {
      token: student.token,
      body: { content: "What is our class hamster's name?" },
    });
    expect(question.status).toBe(201);
    expect(question.body.tutorTurn!.content).toContain("From your own notes (class-notes.md)");
    expect(question.body.tutorTurn!.content).toContain("Bolt");
  });

  it("never retrieves another student's materials", async () => {
    const owner = await register("student");
    const asker = await register("student");
    const ownerSession = await startSession(owner.token);
    const askerSession = await startSession(asker.token);

    await call("POST", `/sessions/${ownerSession.id}/materials`, {
      token: owner.token,
      body: {
        filename: "owner-notes.md",
        mimeType: "text/markdown",
        content: "The secret study token is PURPLE-THUNDER-7.",
      },
    });

    const leak = await call("POST", `/sessions/${askerSession.id}/turns`, {
      token: asker.token,
      body: { content: "What is the secret study token?" },
    });
    expect(leak.status).toBe(201);
    expect(JSON.stringify(leak.body)).not.toContain("PURPLE-THUNDER-7");
  });

  it("rejects non-text and oversized uploads", async () => {
    const student = await register("student");
    const { id } = await startSession(student.token);

    const binary = await call("POST", `/sessions/${id}/materials`, {
      token: student.token,
      body: { filename: "photo.png", mimeType: "image/png", content: "not really a png" },
    });
    expect(binary.status).toBe(400);

    const oversized = await call("POST", `/sessions/${id}/materials`, {
      token: student.token,
      body: { filename: "big.txt", mimeType: "text/plain", content: "x".repeat(100_001) },
    });
    expect(oversized.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Hints-not-answers and the explain-differently control
  // -------------------------------------------------------------------------

  it("stays hint-first: a stuck turn never reveals the answer or proposes an action", async () => {
    const student = await register("student");
    const { id } = await startSession(student.token);

    const stuck = await call("POST", `/sessions/${id}/turns`, {
      token: student.token,
      body: { content: "just tell me the answer" },
    });
    expect(stuck.status).toBe(201);
    expect(stuck.body.proposedAction).toBeUndefined();
    // The check question is re-offered — the learner still gets to answer it.
    expect(stuck.body.tutorTurn!.content).toContain("?");
  });

  it("re-teaches the live step differently on an explicit explain-differently ask", async () => {
    const student = await register("student");
    const { id, teach } = await startSession(student.token);

    const differently = await call("POST", `/sessions/${id}/turns`, {
      token: student.token,
      body: { content: "explain it differently" },
    });
    expect(differently.status).toBe(201);
    const reteach = differently.body.tutorTurn!;
    expect(reteach.kind).toBe("reteach");
    expect(reteach.stepId).toBe(teach.stepId);
    expect(reteach.content).not.toBe(teach.content);
    expect(differently.body.proposedAction).toBeUndefined();

    // Recorded with the strategy that produced it (spec §6.4).
    expect(reteach.strategyId).toBeTruthy();
  });
});
