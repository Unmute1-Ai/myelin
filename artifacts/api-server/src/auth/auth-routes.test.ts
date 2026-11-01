// Route tests for the auth and guardian endpoints (spec §6.1, §7 rows 1/6/7/11).
// Runs against a real PostgreSQL only — set AUTH_TEST_DATABASE_URL (the local
// cluster for this task: port 54329, database primer_auth_test, credentials
// kept outside the repo). `pnpm -r test` stays green without it.

import http from "node:http";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assessments,
  auditLog,
  consents,
  guardianLinks,
  progressEvents,
  users,
} from "@workspace/db/schema";
import { createSessionCodec } from "./session";

const AUTH_TEST_DATABASE_URL = process.env.AUTH_TEST_DATABASE_URL;

// The app reads DATABASE_URL lazily at first query and the session codec reads
// SESSION_SECRET at first sign — set both before anything runs.
if (AUTH_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = AUTH_TEST_DATABASE_URL;
  process.env.SESSION_SECRET ??= "auth-route-test-secret-0123456789abcdef0123456789abcdef";
}
process.env.NODE_ENV ??= "test";

const TRUNCATE_TABLES =
  "users, guardian_links, consents, audit_log, learning_profiles, profile_entries, " +
  "tutoring_sessions, session_turns, assessments, progress_events, accessibility_prefs";

const PASSWORD = "correct-horse-battery-staple-9";
let emailCounter = 0;
function uniqueEmail(prefix: string): string {
  emailCounter += 1;
  return `${prefix}-${emailCounter}@primer-route.test`;
}

interface JsonBody {
  code?: string;
  message?: string;
  user?: { id: string; email: string; role: string; displayName: string };
  link?: { id: string; status: string; consents: Array<{ type: string; revokedAt: string | null }> };
  links?: Array<{ id: string; status: string }>;
  consent?: { id: string };
  student?: { id: string };
  progressEvents?: Array<{ id: string; summary: string }>;
  assessments?: Array<{ id: string; level: string }>;
}

type Result = { status: number; body: JsonBody; setCookie: string[] };

// Bound at module scope so the request helpers can use them; populated in
// beforeAll. Only assigned when the suite is not skipped.
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

/** Register a user and return their session cookie and user id. */
async function register(
  role: string,
  email?: string,
): Promise<{ token: string; userId: string; email: string }> {
  const address = email ?? uniqueEmail(role);
  const res = await call("POST", "/auth/register", {
    body: { email: address, password: PASSWORD, role, displayName: `Test ${role}` },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { token: cookieFrom(res.setCookie), userId: res.body.user!.id, email: address };
}

/** Create a link from a parent cookie to a student email (200 or 201). */
async function linkStudent(parentToken: string, studentEmail: string): Promise<{ id: string; status: string }> {
  const res = await call("POST", "/guardian/links", {
    token: parentToken,
    body: { studentEmail },
  });
  expect([200, 201]).toContain(res.status);
  return res.body.link!;
}

describe.skipIf(!AUTH_TEST_DATABASE_URL)("auth + guardian routes (requires AUTH_TEST_DATABASE_URL)", () => {
  let db: NodePgDatabase;
  let pool: Pool;

  beforeAll(async () => {
    const pg = (await import("pg")).default;
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    pool = new pg.Pool({ connectionString: AUTH_TEST_DATABASE_URL });
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
  // Registration and login
  // ---------------------------------------------------------------------------

  it("registers all four roles and issues an httpOnly session cookie", async () => {
    for (const role of ["student", "parent", "educator", "admin"]) {
      const email = uniqueEmail(role);
      const res = await call("POST", "/auth/register", {
        body: { email, password: PASSWORD, role, displayName: `Test ${role}` },
      });

      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.user!.email).toBe(email);
      expect(res.body.user!.role).toBe(role);
      // The hash never leaves the server.
      expect(Object.keys(res.body.user!).sort()).toEqual(
        ["createdAt", "displayName", "email", "id", "role"].sort(),
      );

      const cookie = res.setCookie.find((c) => c.startsWith("primer_session="));
      expect(cookie).toBeDefined();
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Path=/");
    }
  });

  it("rejects duplicate email registration with 409", async () => {
    const email = uniqueEmail("dupe");
    await register("student", email);
    const res = await call("POST", "/auth/register", {
      body: { email, password: PASSWORD, role: "student", displayName: "Again" },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("email_already_registered");
  });

  it("rejects malformed registration bodies with 400 and never touches the database", async () => {
    const invalid = [
      { email: "not-an-email", password: PASSWORD, role: "student", displayName: "Bad email" },
      { email: uniqueEmail("shortpw"), password: "9chars!!!", role: "student", displayName: "Short pw" },
      { email: uniqueEmail("emptyname"), password: PASSWORD, role: "student", displayName: "" },
      { email: uniqueEmail("badrole"), password: PASSWORD, role: "wizard", displayName: "Bad role" },
      { email: uniqueEmail("norole"), password: PASSWORD, displayName: "No role" },
    ];
    for (const body of invalid) {
      const res = await call("POST", "/auth/register", { body });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.code).toBe("invalid_request");
    }
    const rows = await db.select().from(auditLog);
    expect(rows).toHaveLength(0);
  });

  it("logs in with the correct password and echoes the session user", async () => {
    const { email } = await register("student");
    const res = await call("POST", "/auth/login", { body: { email, password: PASSWORD } });
    expect(res.status).toBe(200);
    expect(res.body.user!.email).toBe(email);

    const me = await call("GET", "/auth/me", { token: cookieFrom(res.setCookie) });
    expect(me.status).toBe(200);
    expect(me.body.user!.id).toBe(res.body.user!.id);
  });

  it("returns one 401 shape for wrong password and unknown email (no account enumeration)", async () => {
    const { email } = await register("student");

    const wrongPassword = await call("POST", "/auth/login", {
      body: { email, password: "definitely-not-the-password" },
    });
    const unknownEmail = await call("POST", "/auth/login", {
      body: { email: uniqueEmail("ghost"), password: PASSWORD },
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.code).toBe("invalid_credentials");
  });

  it("rejects missing, tampered, and expired session tokens with 401", async () => {
    const noCookie = await call("GET", "/auth/me");
    expect(noCookie.status).toBe(401);
    expect(noCookie.body.code).toBe("unauthorized");

    const garbage = await call("GET", "/auth/me", { token: "primer_session=garbage.token" });
    expect(garbage.status).toBe(401);

    // A token signed with a different secret (forged payload).
    const forged = createSessionCodec(() => "forged-secret-0123456789abcdef0123456789abcdef");
    const forgedToken = forged.sign({
      userId: "11111111-1111-4111-8111-111111111111",
      role: "admin",
    });
    const forgedRes = await call("GET", "/auth/me", { token: `primer_session=${forgedToken}` });
    expect(forgedRes.status).toBe(401);

    // A genuinely signed token that has already expired.
    const { userId } = await register("student");
    const expired = createSessionCodec(() => process.env.SESSION_SECRET!, -10);
    const expiredToken = expired.sign({ userId, role: "student" });
    const expiredRes = await call("GET", "/auth/me", { token: `primer_session=${expiredToken}` });
    expect(expiredRes.status).toBe(401);
  });

  it("fails closed when a session token outlives its account", async () => {
    const { token, userId } = await register("student");
    await db.delete(users).where(eq(users.id, userId));

    const res = await call("GET", "/auth/me", { token });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("unauthorized");
  });

  it("clears the session cookie on logout", async () => {
    const { email } = await register("student");
    const login = await call("POST", "/auth/login", { body: { email, password: PASSWORD } });
    const res = await call("POST", "/auth/logout", { token: cookieFrom(login.setCookie) });
    expect(res.status).toBe(204);
    const cleared = res.setCookie.find((c) => c.startsWith("primer_session="));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/(Max-Age=0|Expires=Thu, 01 Jan 1970)/);
  });

  it("marks the session cookie Secure in production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await call("POST", "/auth/register", {
        body: { email: uniqueEmail("prod"), password: PASSWORD, role: "student", displayName: "Prod" },
      });
      expect(res.status).toBe(201);
      expect(res.setCookie.find((c) => c.startsWith("primer_session="))).toContain("Secure");
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  // ---------------------------------------------------------------------------
  // Role gates and the fail-closed default
  // ---------------------------------------------------------------------------

  it("denies a student the parent routes with 403 and a denied audit row", async () => {
    const { token } = await register("student");
    const res = await call("POST", "/guardian/links", {
      token,
      body: { studentEmail: uniqueEmail("student") },
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("forbidden");

    const rows = await db.select().from(auditLog).where(eq(auditLog.action, "route_access"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.decision).toBe("denied");
    expect(rows[0]!.authorizationEvidence).toMatchObject({
      requiredRoles: ["parent"],
      actualRole: "student",
    });
  });

  it("denies educators and admins the parent routes — the privacy layer cannot be overridden", async () => {
    for (const role of ["educator", "admin"]) {
      const { token } = await register(role);
      const res = await call("POST", "/guardian/links", {
        token,
        body: { studentEmail: uniqueEmail("student") },
      });
      expect(res.status, role).toBe(403);
    }
  });

  it("returns 401 without an audit row for unauthenticated requests (no cookie, no actor)", async () => {
    const res = await call("POST", "/guardian/links", {
      body: { studentEmail: uniqueEmail("student") },
    });
    expect(res.status).toBe(401);

    const rows = await db.select().from(auditLog);
    expect(rows).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Guardian consent flow
  // ---------------------------------------------------------------------------

  it("creates a pending guardian link and is idempotent on re-link", async () => {
    const studentEmail = uniqueEmail("student");
    await register("student", studentEmail);
    const parent = await register("parent");

    const first = await linkStudent(parent.token, studentEmail);
    expect(first.status).toBe("pending");

    const again = await linkStudent(parent.token, studentEmail);
    expect(again.id).toBe(first.id);

    const links = await db.select().from(guardianLinks);
    expect(links).toHaveLength(1);
  });

  it("denies progress while the link is pending, allows it once guardian_access consent is recorded", async () => {
    const studentEmail = uniqueEmail("student");
    const student = await register("student", studentEmail);
    const parent = await register("parent");

    // The student has real progress for the parent to (eventually) see.
    await db.insert(progressEvents).values({
      studentId: student.userId,
      kind: "milestone_reached",
      summary: "Finished the money-math lesson",
    });
    await db.insert(assessments).values({
      studentId: student.userId,
      subject: "math",
      skill: "addition",
      level: "memorization",
      evidenceKind: "recall",
      evidenceNote: "Correct recall on two-step money problems",
    });

    const link = await linkStudent(parent.token, studentEmail);

    const pending = await call("GET", `/guardian/students/${student.userId}/progress`, {
      token: parent.token,
    });
    expect(pending.status).toBe(403);
    const deniedRows = await db.select().from(auditLog).where(eq(auditLog.action, "view_progress"));
    expect(deniedRows).toHaveLength(1);
    expect(deniedRows[0]!.decision).toBe("denied");

    const grant = await call("POST", `/guardian/links/${link.id}/consents`, {
      token: parent.token,
      body: { type: "guardian_access", termsVersion: "2026-11-01" },
    });
    expect(grant.status).toBe(201);
    expect(grant.body.link!.status).toBe("granted");
    expect(grant.body.consent!.id).toBeDefined();

    const allowed = await call("GET", `/guardian/students/${student.userId}/progress`, {
      token: parent.token,
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body.student!.id).toBe(student.userId);
    expect(allowed.body.progressEvents).toHaveLength(1);
    expect(allowed.body.assessments).toHaveLength(1);
    expect(allowed.body.assessments![0]!.level).toBe("memorization");

    const allowedRows = await db.select().from(auditLog).where(eq(auditLog.action, "view_progress"));
    expect(allowedRows.some((row: { decision: string }) => row.decision === "allowed")).toBe(true);
  });

  it("does not unlock progress on a learning_data consent alone — the consent trail, not the link, is the authorization", async () => {
    const studentEmail = uniqueEmail("student");
    await register("student", studentEmail);
    const parent = await register("parent");
    const link = await linkStudent(parent.token, studentEmail);

    const learningData = await call("POST", `/guardian/links/${link.id}/consents`, {
      token: parent.token,
      body: { type: "learning_data", termsVersion: "2026-11-01" },
    });
    expect(learningData.status).toBe(201);

    const [linkRow] = await db.select().from(guardianLinks).where(eq(guardianLinks.id, link.id));
    const denied = await call("GET", `/guardian/students/${linkRow!.studentId}/progress`, {
      token: parent.token,
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("forbidden");

    // Recording guardian_access flips the outcome — same link, new consent row.
    const grant = await call("POST", `/guardian/links/${link.id}/consents`, {
      token: parent.token,
      body: { type: "guardian_access", termsVersion: "2026-11-01" },
    });
    expect(grant.status).toBe(201);
    const allowed = await call("GET", `/guardian/students/${linkRow!.studentId}/progress`, {
      token: parent.token,
    });
    expect(allowed.status).toBe(200);
  });

  it("denies cross-family access — a parent with no link to the student gets 403 and a denied audit row", async () => {
    const student = await register("student");
    const outsider = await register("parent"); // registered, never linked

    const res = await call("GET", `/guardian/students/${student.userId}/progress`, {
      token: outsider.token,
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("forbidden");

    const rows = await db.select().from(auditLog).where(eq(auditLog.action, "view_progress"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.decision).toBe("denied");
  });

  it("revocation ends access, preserves the grant trail, and blocks re-consent on a revoked link", async () => {
    const studentEmail = uniqueEmail("student");
    await register("student", studentEmail);
    const parent = await register("parent");
    const link = await linkStudent(parent.token, studentEmail);

    await call("POST", `/guardian/links/${link.id}/consents`, {
      token: parent.token,
      body: { type: "guardian_access", termsVersion: "2026-11-01" },
    });
    const [linkRow] = await db.select().from(guardianLinks).where(eq(guardianLinks.id, link.id));
    const allowed = await call("GET", `/guardian/students/${linkRow!.studentId}/progress`, {
      token: parent.token,
    });
    expect(allowed.status).toBe(200);

    const revoke = await call("POST", `/guardian/links/${link.id}/revoke`, { token: parent.token });
    expect(revoke.status).toBe(200);
    expect(revoke.body.link!.status).toBe("revoked");

    const denied = await call("GET", `/guardian/students/${linkRow!.studentId}/progress`, {
      token: parent.token,
    });
    expect(denied.status).toBe(403);

    // The grant row keeps its grantedAt and gains revokedAt only.
    const grants = await db.select().from(consents).where(eq(consents.guardianLinkId, link.id));
    expect(grants).toHaveLength(1);
    expect(grants[0]!.grantedAt).toBeInstanceOf(Date);
    expect(grants[0]!.revokedAt).toBeInstanceOf(Date);

    const revokeRows = await db.select().from(auditLog).where(eq(auditLog.action, "revoke_guardian_link"));
    expect(revokeRows).toHaveLength(1);

    const reconsent = await call("POST", `/guardian/links/${link.id}/consents`, {
      token: parent.token,
      body: { type: "guardian_access", termsVersion: "2026-11-01" },
    });
    expect(reconsent.status).toBe(409);
    expect(reconsent.body.code).toBe("link_revoked");
  });

  it("a parent sees only their own links", async () => {
    const studentEmail = uniqueEmail("student");
    await register("student", studentEmail);
    const parentA = await register("parent");
    await linkStudent(parentA.token, studentEmail);

    const other = await register("parent");
    const mine = await call("GET", "/guardian/links", { token: parentA.token });
    expect(mine.status).toBe(200);
    expect(mine.body.links).toHaveLength(1);

    const theirs = await call("GET", "/guardian/links", { token: other.token });
    expect(theirs.status).toBe(200);
    expect(theirs.body.links).toHaveLength(0);
  });
});
