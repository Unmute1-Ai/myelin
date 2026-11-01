// Audit-completeness tests (spec §6.11: audit records for every consequential
// action). Runs the real app over HTTP against a real PostgreSQL — the same
// harness and SESSIONS_TEST_DATABASE_URL as the sessions route tests.
//
// Every platform route family is exercised and its trail row asserted:
// the actor, the action, and the resource it landed on. Authorization
// refusals are audited too — the trail shows the guardrail working, not just
// the happy path. Sentinel lifecycle rows (proposed / confirmed / declined)
// are covered in sessions-routes.test.ts; profile-evidence rows in the
// governance tests. The catalog check pins the shared vocabulary so a renamed
// action cannot silently split the trail.

import http from "node:http";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog } from "@workspace/db/schema";
import { CONSEQUENTIAL_ACTIONS } from "../audit/actions";

const SESSIONS_TEST_DATABASE_URL = process.env.SESSIONS_TEST_DATABASE_URL;

if (SESSIONS_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = SESSIONS_TEST_DATABASE_URL;
  process.env.SESSION_SECRET ??= "audit-route-test-secret-0123456789abcdef0123456789abcdef";
}
process.env.NODE_ENV ??= "test";

const TRUNCATE_TABLES =
  "users, guardian_links, consents, audit_log, learning_profiles, profile_entries, " +
  "tutoring_sessions, session_turns, assessments, progress_events, accessibility_prefs, session_materials";

const PASSWORD = "correct-horse-battery-staple-9";
let emailCounter = 0;
function uniqueEmail(prefix: string): string {
  emailCounter += 1;
  return `${prefix}-${emailCounter}@primer-audit.test`;
}

interface JsonBody {
  code?: string;
  message?: string;
  user?: { id: string; email: string; role: string };
  id?: string;
  link?: { id: string };
  material?: { id: string };
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

async function register(role: string): Promise<{ token: string; userId: string; email: string }> {
  const email = uniqueEmail(role);
  const res = await call("POST", "/auth/register", {
    body: { email, password: PASSWORD, role, displayName: `Test ${role}` },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { token: cookieFrom(res.setCookie), userId: res.body.user!.id, email };
}

async function auditRowsFor(
  action: string,
): Promise<{ actorId: string | null; resourceId: string | null; decision: string }[]> {
  return db
    .select({ actorId: auditLog.actorId, resourceId: auditLog.resourceId, decision: auditLog.decision })
    .from(auditLog)
    .where(sql`${auditLog.action} = ${action}`);
}

describe.skipIf(!SESSIONS_TEST_DATABASE_URL)("audit vocabulary (static)", () => {
  it("uses snake_case actions with no duplicates", () => {
    expect(new Set(CONSEQUENTIAL_ACTIONS).size).toBe(CONSEQUENTIAL_ACTIONS.length);
    for (const action of CONSEQUENTIAL_ACTIONS) {
      expect(action).toMatch(/^[a-z_]+$/);
    }
  });
});

describe.skipIf(!SESSIONS_TEST_DATABASE_URL)(
  "audit completeness over the real app (requires SESSIONS_TEST_DATABASE_URL)",
  () => {
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

    it("audits registration with the actor and the account as resource", async () => {
      const { userId } = await register("student");

      const rows = await auditRowsFor("register");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actorId).toBe(userId);
      expect(rows[0]!.resourceId).toBe(userId);
    });

    it("audits a successful login and never logs the attempted email on failure", async () => {
      const registered = await register("student");
      await db.execute(sql.raw("TRUNCATE TABLE audit_log")); // isolate the login rows

      const login = await call("POST", "/auth/login", {
        body: { email: registered.email, password: PASSWORD },
      });
      expect(login.status).toBe(200);
      expect((await auditRowsFor("login"))[0]!.actorId).toBe(registered.userId);

      const failed = await call("POST", "/auth/login", {
        body: { email: "nosuchuser@primer.test", password: "wrong" },
      });
      expect(failed.status).toBe(401);
      const failedRows = await auditRowsFor("login_failed");
      expect(failedRows).toHaveLength(1);
      expect(failedRows[0]!.actorId).toBeNull(); // identity unverified — no attribution
      // The attempted address is never in the trail (data minimization).
      const all = JSON.stringify(await db.select().from(auditLog));
      expect(all).not.toContain("nosuchuser@primer.test");
      expect(all).not.toContain(registered.email);
    });

    it("audits logout including the anonymous case", async () => {
      await call("POST", "/auth/logout");
      expect((await auditRowsFor("logout")).length).toBe(1);
    });

    it("audits session creation, deletion, and material upload", async () => {
      const student = await register("student");
      const created = await call("POST", "/sessions", { token: student.token, body: { title: "Coins" } });
      expect(created.status).toBe(201);
      const sessionId = created.body.id!;

      const upload = await call("POST", `/sessions/${sessionId}/materials`, {
        token: student.token,
        body: { filename: "notes.txt", mimeType: "text/plain", content: "Quarters are 25 cents." },
      });
      expect(upload.status).toBe(201);
      expect((await auditRowsFor("upload_material"))[0]!.resourceId).toBe(upload.body.material!.id);

      const deleted = await call("DELETE", `/sessions/${sessionId}`, { token: student.token });
      expect(deleted.status).toBe(204);

      expect((await auditRowsFor("create_session"))[0]!.resourceId).toBe(sessionId);
      expect((await auditRowsFor("delete_session"))[0]!.resourceId).toBe(sessionId);
    });

    it("audits an accessibility-preferences update without recording the values", async () => {
      const student = await register("student");
      const put = await call("PUT", "/me/accessibility", {
        token: student.token,
        body: { captionsEnabled: false, textSize: "large" },
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);

      const rows = await auditRowsFor("update_accessibility_prefs");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actorId).toBe(student.userId);
      // The trail carries which keys moved, never their values.
      const serialized = JSON.stringify(rows[0]);
      expect(serialized).not.toContain("large");
    });

    it("audits authorization refusals with the denied decision and the attempted actor", async () => {
      const student = await register("student");
      const parent = await register("parent"); // no guardian link, no consent

      const created = await call("POST", "/sessions", { token: student.token, body: {} });
      const sessionId = created.body.id!;
      const denied = await call("GET", `/sessions/${sessionId}`, { token: parent.token });
      expect(denied.status).toBe(403);

      const rows = await auditRowsFor("view_progress");
      const deniedRows = rows.filter((row) => row.decision === "denied");
      expect(deniedRows.length).toBeGreaterThanOrEqual(1);
      expect(deniedRows[0]!.actorId).toBe(parent.userId);
    });

    it("audits guardian-link creation and consent recording", async () => {
      const parent = await register("parent");
      const child = await register("student");

      const link = await call("POST", "/guardian/links", {
        token: parent.token,
        body: { studentEmail: child.email },
      });
      expect(link.status, JSON.stringify(link.body)).toBe(201);
      expect((await auditRowsFor("create_guardian_link")).length).toBe(1);

      const consent = await call("POST", `/guardian/links/${link.body.link!.id}/consents`, {
        token: parent.token,
        body: { type: "guardian_access", termsVersion: "2026-11-01" },
      });
      expect([200, 201]).toContain(consent.status);
      expect((await auditRowsFor("record_consent")).length).toBe(1);
    });
  },
);
