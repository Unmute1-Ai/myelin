// Retention tests (spec §6.11: retention controls on profile data). Runs
// against a real PostgreSQL only — set SESSIONS_TEST_DATABASE_URL (the same
// local test database the sessions route tests use); `pnpm -r test` stays
// green without it. Mirrors lib/db's round-trip harness: real migrations,
// real constraints, TRUNCATE between tests.
//
// The properties under test, each derived from the schema (see retention.ts):
//   - the sweep erases expired COMPLETED sessions and their cascaded
//     turns/materials;
//   - mastery evidence survives (assessments.session_id is SET NULL);
//   - evidence protection outranks retention — a session whose turn is cited
//     by a profile entry is SKIPPED, never partially erased;
//   - active and recent sessions are out of scope;
//   - the run is audited with counts only;
//   - dormancy counting never deletes anything.

import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assessments,
  auditLog,
  learningProfiles,
  profileEntries,
  sessionMaterials,
  sessionTurns,
  tutoringSessions,
  users,
} from "@workspace/db/schema";
import { dbAuditLogger } from "../auth/audit";
import { RETENTION_EXEMPT_TABLES, countDormantAccounts, runRetentionSweep } from "./retention";

const SESSIONS_TEST_DATABASE_URL = process.env.SESSIONS_TEST_DATABASE_URL;

const TRUNCATE_TABLES =
  "users, guardian_links, consents, audit_log, learning_profiles, profile_entries, " +
  "tutoring_sessions, session_turns, assessments, progress_events, accessibility_prefs, session_materials";

let emailCounter = 0;
function uniqueEmail(prefix: string): string {
  emailCounter += 1;
  return `${prefix}-${emailCounter}@primer-retention.test`;
}

/** A timestamp `ageDays` in the past. */
function aged(ageDays: number): Date {
  return new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
}

describe.skipIf(!SESSIONS_TEST_DATABASE_URL)("retention sweep (requires SESSIONS_TEST_DATABASE_URL)", () => {
  let pool: Pool;
  let db: NodePgDatabase;

  beforeAll(async () => {
    const pg = (await import("pg")).default;
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    pool = new pg.Pool({ connectionString: SESSIONS_TEST_DATABASE_URL });
    db = drizzle(pool);
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../../../../lib/db/drizzle", import.meta.url)),
    });
  }, 30_000);

  afterAll(async () => {
    await pool.end();
  });

  /** The sweep with the platform's audit port wired, so the run lands a trail row. */
  function sweep(windowDays: number) {
    return runRetentionSweep(db, windowDays, dbAuditLogger(() => db));
  }

  beforeEach(async () => {
    await db.execute(sql.raw(`TRUNCATE TABLE ${TRUNCATE_TABLES} CASCADE`));
  });

  async function insertStudent(): Promise<string> {
    const [student] = await db
      .insert(users)
      .values({
        email: uniqueEmail("student"),
        passwordHash: "test-hash",
        role: "student",
        displayName: "Retention Student",
      })
      .returning();
    return student.id;
  }

  /** A completed session with two turns and one material, aged `ageDays`. */
  async function insertExpiredSession(
    studentId: string,
    ageDays: number,
    status: "active" | "completed" = "completed",
  ): Promise<string> {
    const [session] = await db
      .insert(tutoringSessions)
      .values({
        studentId,
        status,
        startedAt: aged(ageDays),
        lastTurnAt: aged(ageDays),
      })
      .returning();
    await db.insert(sessionTurns).values([
      { sessionId: session.id, seq: 1, author: "tutor", content: "Two quarters make fifty cents." },
      { sessionId: session.id, seq: 2, author: "student", content: "I counted them." },
    ]);
    await db.insert(sessionMaterials).values({
      sessionId: session.id,
      studentId,
      filename: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 20,
      contentText: "quarters are 25 cents each",
    });
    return session.id;
  }

  it("erases an expired completed session and its cascaded turns and materials", async () => {
    const studentId = await insertStudent();
    const sessionId = await insertExpiredSession(studentId, 45);

    const result = await sweep(30);

    expect(result).toEqual({ sessionsDeleted: 1, sessionsSkippedCited: 0 });
    const left = await db.select().from(tutoringSessions).where(eq(tutoringSessions.id, sessionId));
    expect(left).toHaveLength(0);
    expect(await db.select().from(sessionTurns).where(eq(sessionTurns.sessionId, sessionId))).toHaveLength(0);
    expect(await db.select().from(sessionMaterials).where(eq(sessionMaterials.sessionId, sessionId))).toHaveLength(0);
  });

  it("spares active and recent sessions", async () => {
    const studentId = await insertStudent();
    const oldActive = await insertExpiredSession(studentId, 45, "active");
    const recentCompleted = await insertExpiredSession(studentId, 3);

    const result = await sweep(30);

    expect(result.sessionsDeleted).toBe(0);
    expect((await db.select().from(tutoringSessions)).length).toBe(2);
    expect((await db.select().from(sessionTurns).where(eq(sessionTurns.sessionId, oldActive))).length).toBe(2);
    expect((await db.select().from(sessionTurns).where(eq(sessionTurns.sessionId, recentCompleted))).length).toBe(2);
  });

  it("mastery evidence survives the sweep — the assessment detaches, not disappears", async () => {
    const studentId = await insertStudent();
    const sessionId = await insertExpiredSession(studentId, 45);
    await db.insert(assessments).values({
      studentId,
      sessionId,
      subject: "math.money",
      level: "recognition",
      evidenceKind: "recall",
      evidenceNote: "Recognized the coin values without prompting.",
    });

    const result = await sweep(30);

    expect(result.sessionsDeleted).toBe(1);
    const evidence = await db.select().from(assessments).where(eq(assessments.studentId, studentId));
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.sessionId).toBeNull(); // SET NULL, not erased
    expect(evidence[0]!.evidenceNote).toContain("Recognized the coin values");
  });

  it("evidence protection outranks retention — a cited turn's session is skipped, not erased", async () => {
    const studentId = await insertStudent();
    const sessionId = await insertExpiredSession(studentId, 45);
    const [turn] = await db
      .select()
      .from(sessionTurns)
      .where(eq(sessionTurns.sessionId, sessionId));
    const [profile] = await db
      .insert(learningProfiles)
      .values({ studentId, subjects: ["math.money"] })
      .returning();
    await db.insert(profileEntries).values({
      profileId: profile.id,
      kind: "gap",
      detail: "Counting by fives stalls after two groups.",
      sourceTurnId: turn.id,
    });

    const result = await sweep(30);

    // §6.0: no entry ever cites a ghost — the session (and its turn) survives.
    expect(result).toEqual({ sessionsDeleted: 0, sessionsSkippedCited: 1 });
    expect((await db.select().from(tutoringSessions).where(eq(tutoringSessions.id, sessionId))).length).toBe(1);
    expect((await db.select().from(sessionTurns).where(eq(sessionTurns.sessionId, sessionId))).length).toBe(2);
  });

  it("audits the run with counts only — never learner content", async () => {
    const studentId = await insertStudent();
    await insertExpiredSession(studentId, 45);

    await sweep(30);

    const rows = await db.select().from(auditLog);
    const sweepRows = rows.filter((row) => row.action === "retention_sweep_executed");
    expect(sweepRows).toHaveLength(1);
    const serialized = JSON.stringify(sweepRows[0]);
    expect(serialized).not.toContain("fifty cents");
    expect(serialized).not.toContain("counted them");
  });

  it("leaves the exempt tables untouched", async () => {
    const studentId = await insertStudent();
    await insertExpiredSession(studentId, 45);
    const before = await db.select({ count: sql<number>`count(*)::int` }).from(auditLog);

    await sweep(30);

    const after = await db.select({ count: sql<number>`count(*)::int` }).from(auditLog);
    expect(after[0]!.count).toBe(before[0]!.count + 1); // only the sweep's own row
    expect(RETENTION_EXEMPT_TABLES).toContain("audit_log");
    expect(RETENTION_EXEMPT_TABLES).toContain("profile_entries");
  });

  it("counts dormant accounts without deleting anything", async () => {
    const learnerId = await insertStudent();
    await insertExpiredSession(learnerId, 400);
    const dormantId = await insertStudent();
    await db.update(users).set({ createdAt: aged(400) }).where(eq(users.id, dormantId));
    await db.update(users).set({ createdAt: new Date() }).where(eq(users.id, learnerId));

    const dormant = await countDormantAccounts(db, 365);

    expect(dormant).toBe(1);
    expect((await db.select().from(users)).length).toBe(2); // nothing deleted
  });
});
