// Route tests for the pilot endpoints (U1Si-Q): invite-code enrollment and
// the generalized Sentinel gate demo. Runs against a real PostgreSQL only —
// set PILOT_TEST_DATABASE_URL (the local cluster for this task: port 54329,
// database primer_auth_test, credentials kept outside the repo). `pnpm -r
// test` stays green without it.
//
// The gate tests pin the two invariants that matter: a proposal executes
// nothing without a human confirmation (and a confirmer who isn't the
// proposer), and confirmation executes EXACTLY once — the second confirm
// finds the claim taken and lands in 409.

import http from "node:http";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog, pilotProposals } from "@workspace/db/schema";

const PILOT_TEST_DATABASE_URL = process.env.PILOT_TEST_DATABASE_URL;

// The app reads DATABASE_URL lazily at first query and the session codec reads
// SESSION_SECRET at first sign — set both before anything runs.
if (PILOT_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = PILOT_TEST_DATABASE_URL;
  process.env.SESSION_SECRET ??= "pilot-route-test-secret-0123456789abcdef0123456789abcdef";
}
process.env.NODE_ENV ??= "test";

const TRUNCATE_TABLES =
  "users, pilot_invites, pilot_enrollments, pilot_proposals, audit_log, guardian_links, consents";

const PASSWORD = "correct-horse-battery-staple-9";
let emailCounter = 0;
function uniqueEmail(prefix: string): string {
  emailCounter += 1;
  return `${prefix}-${emailCounter}@pilot-route.test`;
}

interface JsonBody {
  code?: string;
  message?: string;
  user?: { id: string; email: string; role: string; displayName: string };
  invite?: { id: string; code: string };
  proposal?: {
    id: string;
    action: string;
    status: string;
    checkLine: string;
    proposedByName: string | null;
    decidedByName: string | null;
    result: Record<string, unknown> | null;
  };
  proposals?: Array<{ id: string; status: string; action: string; proposedByName: string | null }>;
  enrollments?: Array<{
    participant: { email: string; role?: string };
    enrollment: { consent: { consentVersion: string }; source: string };
  }>;
}

type Result = { status: number; body: JsonBody; setCookie: string[] };

let server: http.Server | undefined;
let baseUrl = "";
let db: NodePgDatabase;
let pool: Pool;

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

/** Register a user and return their session cookie and user id. */
async function register(role: string): Promise<{ token: string; userId: string }> {
  const email = uniqueEmail(role);
  const res = await call("POST", "/auth/register", {
    body: { email, password: PASSWORD, role, displayName: `Test ${role}` },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { token: cookieFrom(res.setCookie), userId: res.body.user!.id };
}

/** Admin issues an invite code and returns it. */
async function issueInvite(adminToken: string): Promise<string> {
  const res = await call("POST", "/pilot/invites", {
    token: adminToken,
    body: { note: "test invite", expiresInDays: 7 },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.invite!.code;
}

function enrollBody(code: string, email: string) {
  return {
    code,
    email,
    password: PASSWORD,
    displayName: "Pilot Tester",
    contactMethod: "email",
    contactValue: email,
    accessibility: { captionsEnabled: true, textSize: "medium", aacInputEnabled: false, reducedMotion: false },
    consent: { consentToParticipate: true, consentToLearningData: true, consentVersion: "pilot-v1" },
  };
}

/** Audit rows for one action name, newest last. */
async function auditRowsFor(action: string) {
  return db.select().from(auditLog).where(eq(auditLog.action, action));
}

describe.skipIf(!PILOT_TEST_DATABASE_URL)("pilot routes (requires PILOT_TEST_DATABASE_URL)", () => {
  beforeAll(async () => {
    const pg = (await import("pg")).default;
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    pool = new pg.Pool({ connectionString: PILOT_TEST_DATABASE_URL });
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

  // ---------------------------------------------------------------------------
  // Invite codes + enrollment
  // ---------------------------------------------------------------------------

  it("enrolls a pilot participant with a valid code and issues a session", async () => {
    const admin = await register("admin");
    const code = await issueInvite(admin.token);
    const email = uniqueEmail("pilot");

    const res = await call("POST", "/pilot/enroll", { body: enrollBody(code, email) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.user!.role).toBe("pilot_participant");
    expect(res.setCookie.some((c) => c.startsWith("primer_session="))).toBe(true);
  });

  it("refuses enrollment without a valid code, with a used code, or without consent", async () => {
    const admin = await register("admin");
    const code = await issueInvite(admin.token);
    const email = uniqueEmail("pilot");

    const badCode = await call("POST", "/pilot/enroll", {
      body: enrollBody("not-a-real-code", email),
    });
    expect(badCode.status).toBe(403);
    expect(badCode.body.code).toBe("invalid_invite");

    const noConsent = await call("POST", "/pilot/enroll", {
      body: { ...enrollBody(code, email), consent: { ...enrollBody(code, email).consent, consentToParticipate: false } },
    });
    expect(noConsent.status).toBe(400);

    const ok = await call("POST", "/pilot/enroll", { body: enrollBody(code, email) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);

    const reuse = await call("POST", "/pilot/enroll", {
      body: enrollBody(code, uniqueEmail("pilot")),
    });
    expect(reuse.status).toBe(409);
    expect(reuse.body.code).toBe("invite_already_used");
  });

  it("refuses an expired code with 410", async () => {
    const admin = await register("admin");
    const code = await issueInvite(admin.token);
    await db.execute(
      sql.raw(`UPDATE pilot_invites SET expires_at = now() - interval '1 day' WHERE code = '${code}'`),
    );

    const res = await call("POST", "/pilot/enroll", {
      body: enrollBody(code, uniqueEmail("pilot")),
    });
    expect(res.status).toBe(410);
    expect(res.body.code).toBe("invite_expired");
  });

  it("keeps the enrollment list founder-only and audits the refusal", async () => {
    const admin = await register("admin");
    const code = await issueInvite(admin.token);
    const enrolled = await call("POST", "/pilot/enroll", {
      body: enrollBody(code, uniqueEmail("pilot")),
    });
    expect(enrolled.status).toBe(201);
    const participantToken = cookieFrom(enrolled.setCookie);

    const denied = await call("GET", "/pilot/enrollments", { token: participantToken });
    expect(denied.status).toBe(403);

    const refusals = await db.select().from(auditLog).where(eq(auditLog.decision, "denied"));
    expect(refusals.some((row) => row.actorId === enrolled.body.user!.id)).toBe(true);

    const allowed = await call("GET", "/pilot/enrollments", { token: admin.token });
    expect(allowed.status).toBe(200);
    expect(allowed.body.enrollments).toHaveLength(1);
    expect(allowed.body.enrollments![0]!.enrollment.consent.consentVersion).toBe("pilot-v1");
    expect(allowed.body.enrollments![0]!.enrollment.source).toBe("invite_code");
  });

  it("refuses invite issuance to non-admins", async () => {
    const student = await register("student");
    const res = await call("POST", "/pilot/invites", {
      token: student.token,
      body: { note: "sneaky", expiresInDays: 7 },
    });
    expect(res.status).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // The generalized gate demo
  // ---------------------------------------------------------------------------

  it("parks a proposal as pending state and executes nothing without confirmation", async () => {
    const student = await register("student");
    const res = await call("POST", "/pilot/proposals", {
      token: student.token,
      body: { action: "export_pilot_report" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.proposal!.status).toBe("pending");
    expect(res.body.proposal!.checkLine).toContain("Nothing runs until a founder approves it");

    const listed = await call("GET", "/pilot/proposals", { token: student.token });
    expect(listed.body.proposals).toHaveLength(1);
    expect(listed.body.proposals![0]!.proposedByName).toBe("Test student");

    // No execution happened: the proposal row holds pending state only.
    const rows = await db.select().from(pilotProposals);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.result).toBeNull();
    expect(rows[0]!.decidedAt).toBeNull();
  });

  it("refuses confirmation without approval — proposer cannot confirm, non-admin cannot confirm", async () => {
    const student = await register("student");
    const other = await register("parent");
    const admin = await register("admin");
    const proposed = await call("POST", "/pilot/proposals", {
      token: student.token,
      body: { action: "export_pilot_report" },
    });
    const id = proposed.body.proposal!.id;

    const byProposer = await call("POST", `/pilot/proposals/${id}/confirm`, {
      token: student.token,
      body: { accepted: true },
    });
    expect(byProposer.status).toBe(403);

    const byNonAdmin = await call("POST", `/pilot/proposals/${id}/confirm`, {
      token: other.token,
      body: { accepted: true },
    });
    expect(byNonAdmin.status).toBe(403);

    // Both refusals are audited, and the proposal is still pending.
    const denials = await db.select().from(auditLog).where(eq(auditLog.decision, "denied"));
    expect(denials.filter((row) => row.action === "confirm_gated_action")).toHaveLength(2);
    const rows = await db.select().from(pilotProposals);
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.result).toBeNull();
    expect(rows[0]!.decidedAt).toBeNull();
    expect(admin.token).toBeDefined();
  });

  it("executes exactly once with an approval — a competing confirm lands in 409", async () => {
    const student = await register("student");
    const admin = await register("admin");
    const proposed = await call("POST", "/pilot/proposals", {
      token: student.token,
      body: { action: "export_pilot_report" },
    });
    const id = proposed.body.proposal!.id;

    const first = await call("POST", `/pilot/proposals/${id}/confirm`, {
      token: admin.token,
      body: { accepted: true },
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.proposal!.status).toBe("executed");
    expect(first.body.proposal!.result).toMatchObject({ report: "pilot_enrollments" });

    // The atomic claim is spent: a second confirm finds nothing to decide.
    const second = await call("POST", `/pilot/proposals/${id}/confirm`, {
      token: admin.token,
      body: { accepted: true },
    });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("no_pending_action");

    // Exactly one executed audit row for this proposal.
    const executed = await auditRowsFor("pilot_action_executed");
    expect(executed).toHaveLength(1);
  });

  it("resolves concurrent confirmations to exactly one execution", async () => {
    const student = await register("student");
    const admin = await register("admin");
    const proposed = await call("POST", "/pilot/proposals", {
      token: student.token,
      body: { action: "export_pilot_report" },
    });
    const id = proposed.body.proposal!.id;

    const [a, b] = await Promise.all([
      call("POST", `/pilot/proposals/${id}/confirm`, { token: admin.token, body: { accepted: true } }),
      call("POST", `/pilot/proposals/${id}/confirm`, { token: admin.token, body: { accepted: true } }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const winner = a.status === 200 ? a : b;
    expect(winner.body.proposal!.status).toBe("executed");
  });

  it("records a decline with the decision trail and no execution", async () => {
    const student = await register("student");
    const admin = await register("admin");
    const proposed = await call("POST", "/pilot/proposals", {
      token: student.token,
      body: { action: "export_pilot_report" },
    });
    const id = proposed.body.proposal!.id;

    const res = await call("POST", `/pilot/proposals/${id}/confirm`, {
      token: admin.token,
      body: { accepted: false },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.proposal!.status).toBe("declined");
    expect(res.body.proposal!.decidedByName).toBe("Test admin");

    const declined = await auditRowsFor("pilot_action_declined");
    expect(declined).toHaveLength(1);
    const executed = await auditRowsFor("pilot_action_executed");
    expect(executed).toHaveLength(0);

    // A declined proposal cannot be resurrected or executed later.
    const resurrect = await call("POST", `/pilot/proposals/${id}/confirm`, {
      token: admin.token,
      body: { accepted: true },
    });
    expect(resurrect.status).toBe(409);
  });

  it("keeps non-admin proposal lists scoped to their own proposals", async () => {
    const student = await register("student");
    const other = await register("parent");
    const admin = await register("admin");
    await call("POST", "/pilot/proposals", {
      token: student.token,
      body: { action: "export_pilot_report" },
    });
    await call("POST", "/pilot/proposals", {
      token: other.token,
      body: { action: "export_pilot_report" },
    });

    const mine = await call("GET", "/pilot/proposals", { token: student.token });
    expect(mine.body.proposals).toHaveLength(1);

    const all = await call("GET", "/pilot/proposals", { token: admin.token });
    expect(all.body.proposals).toHaveLength(2);
  });
});
