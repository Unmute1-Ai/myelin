import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  accessibilityPrefs,
  assessments,
  auditLog,
  consents,
  guardianLinks,
  insertAssessmentSchema,
  learningProfiles,
  profileEntries,
  progressEvents,
  sessionTurns,
  tutoringSessions,
  users,
} from "./index";

/**
 * Round-trip against a real PostgreSQL. Runs only when DATABASE_URL is set —
 * `pnpm -r test` stays green without a database; with one provisioned, these
 * verify the generated migrations actually apply and the constraints hold
 * (spec: migrations run clean on a fresh PostgreSQL).
 */

const DATABASE_URL = process.env.DATABASE_URL;

/**
 * drizzle-orm wraps driver errors in DrizzleQueryError; the pg error code
 * (23514 check violation, 23505 unique violation, …) lives on `cause`.
 * Accepts both shapes so a future unwrapped version still matches.
 */
async function expectPgCode(
  run: () => Promise<unknown>,
  code: "23514" | "23505" | "23001",
) {
  try {
    await run();
  } catch (error) {
    const candidates = [
      error as { code?: string } | undefined,
      (error as { cause?: { code?: string } }).cause,
    ];
    if (candidates.some((candidate) => candidate?.code === code)) return;
    throw error;
  }
  throw new Error(`expected PostgreSQL error ${code}, but the statement succeeded`);
}

describe.skipIf(!DATABASE_URL)("db round-trip (requires DATABASE_URL)", () => {
  let pool: Pool | undefined;
  let db: NodePgDatabase | undefined;

  const allTables = [
    auditLog,
    progressEvents,
    accessibilityPrefs,
    profileEntries,
    assessments,
    sessionTurns,
    tutoringSessions,
    learningProfiles,
    consents,
    guardianLinks,
    users,
  ];

  beforeAll(async () => {
    const pg = (await import("pg")).default;
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");

    pool = new pg.Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool);
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
    });
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await db!.execute(
      sql`TRUNCATE TABLE ${sql.join(
        allTables.map((t) => sql`${t}`),
        sql`, `,
      )} CASCADE`,
    );
  });

  async function insertUser(
    email: string,
    role: "student" | "parent" | "educator",
  ) {
    const [row] = await db!
      .insert(users)
      .values({ email, passwordHash: "test-hash", role, displayName: email })
      .returning();
    return row;
  }

  it("round-trips a user through insert and select with defaults applied", async () => {
    const inserted = await insertUser("student@primer.test", "student");
    expect(inserted.role).toBe("student");

    const selected = await db!
      .select()
      .from(users)
      .where(sql`${users.email} = 'student@primer.test'`);
    expect(selected).toHaveLength(1);
    expect(selected[0].displayName).toBe("student@primer.test");
    expect(selected[0].createdAt).toBeInstanceOf(Date);
  });

  it("enforces the guardian-link self-link ban at the database level", async () => {
    const parent = await insertUser("parent@primer.test", "parent");
    await expectPgCode(
      () => db!.insert(guardianLinks).values({ parentId: parent.id, studentId: parent.id }),
      "23514",
    );
  });

  it("enforces the mastery-evidence rule at the database level", async () => {
    const student = await insertUser("student@primer.test", "student");
    await expectPgCode(
      () =>
        db!.insert(assessments).values({
          studentId: student.id,
          subject: "math.money",
          level: "comprehension",
          evidenceKind: "recall",
          evidenceNote: "answered correctly",
        }),
      "23514",
    );

    const [ok] = await db!
      .insert(assessments)
      .values({
        studentId: student.id,
        subject: "math.money",
        level: "comprehension",
        evidenceKind: "application",
        evidenceNote: "solved a novel problem",
      })
      .returning();
    expect(ok.level).toBe("comprehension");
  });

  it("round-trips the consent chain: link → consent → profile → session → turns → assessment", async () => {
    const parent = await insertUser("parent@primer.test", "parent");
    const student = await insertUser("student@primer.test", "student");

    const [link] = await db!
      .insert(guardianLinks)
      .values({ parentId: parent.id, studentId: student.id, status: "granted" })
      .returning();

    const [consent] = await db!
      .insert(consents)
      .values({ guardianLinkId: link.id, type: "learning_data", termsVersion: "v1.0" })
      .returning();
    expect(consent.grantedAt).toBeInstanceOf(Date);

    const [profile] = await db!
      .insert(learningProfiles)
      .values({ studentId: student.id, subjects: ["math.money"], preferredStrategy: "visual" })
      .returning();

    const [session] = await db!
      .insert(tutoringSessions)
      .values({ studentId: student.id, title: "Money math" })
      .returning();

    const turnRows = await db!
      .insert(sessionTurns)
      .values([
        { sessionId: session.id, seq: 1, author: "student", content: "I don't get making change." },
        { sessionId: session.id, seq: 2, author: "tutor", content: "Let's look at a picture.", strategyId: "visual" },
      ])
      .returning();
    expect(turnRows).toHaveLength(2);

    // Duplicate (session, seq) violates the unique constraint.
    await expectPgCode(
      () =>
        db!
          .insert(sessionTurns)
          .values({ sessionId: session.id, seq: 1, author: "tutor", content: "again" }),
      "23505",
    );

    const parsed = insertAssessmentSchema.parse({
      studentId: student.id,
      sessionId: session.id,
      turnId: turnRows[1].id,
      subject: "math.money",
      level: "comprehension",
      evidenceKind: "application",
      evidenceNote: "novel problem solved after the visual explanation",
    });
    const [assessment] = await db!.insert(assessments).values(parsed).returning();
    expect(assessment.turnId).toBe(turnRows[1].id);
  });

  it("keeps the audit trail when an actor is deleted (append-only, set null)", async () => {
    const student = await insertUser("student@primer.test", "student");
    await db!.insert(auditLog).values({
      actorId: student.id,
      action: "export_data",
      resourceType: "learning_profiles",
      decision: "denied",
      authorizationEvidence: { role: "educator", reason: "not the student's educator" },
    });

    await db!.delete(users).where(sql`${users.id} = ${student.id}`);

    const rows = await db!.select().from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBeNull();
    expect(rows[0].action).toBe("export_data");
    expect(rows[0].decision).toBe("denied");
  });

  it("keeps cited evidence undeletable and its lifecycle auditable (spec §6.0)", async () => {
    const student = await insertUser("student@primer.test", "student");
    const [profile] = await db!
      .insert(learningProfiles)
      .values({ studentId: student.id, subjects: ["math.money"] })
      .returning();
    const parsed = insertAssessmentSchema.parse({
      studentId: student.id,
      subject: "math.money",
      level: "memorization",
      evidenceKind: "recall",
      evidenceNote: "Answered a practiced problem correctly from memory.",
    });
    const [assessment] = await db!.insert(assessments).values(parsed).returning();
    const [entry] = await db!
      .insert(profileEntries)
      .values({
        profileId: profile.id,
        kind: "gap",
        detail: "The skill stops at recall.",
        sourceAssessmentId: assessment.id,
      })
      .returning();

    // Hard delete of cited evidence is refused at the schema level — the
    // citation can never ghost (23001 restrict_violation).
    await expectPgCode(
      () =>
        db!
          .delete(assessments)
          .where(sql`${assessments.id} = ${assessment.id}`),
      "23001",
    );

    // The lifecycle path instead: tombstone the evidence, invalidate the
    // dependent entry — the citation itself survives for audit.
    const at = new Date("2026-11-01T12:00:00.000Z");
    await db!
      .update(assessments)
      .set({ revokedAt: at })
      .where(sql`${assessments.id} = ${assessment.id}`);
    await db!
      .update(profileEntries)
      .set({
        invalidatedAt: at,
        invalidatedReason: `evidence ${assessment.id} revoked: the recorded observation was wrong`,
      })
      .where(sql`${profileEntries.id} = ${entry.id}`);

    const [tombstoned] = await db!
      .select()
      .from(assessments)
      .where(sql`${assessments.id} = ${assessment.id}`);
    expect(tombstoned.revokedAt).toEqual(at);

    const [invalidated] = await db!
      .select()
      .from(profileEntries)
      .where(sql`${profileEntries.id} = ${entry.id}`);
    expect(invalidated.invalidatedAt).toEqual(at);
    expect(invalidated.invalidatedReason).toContain(assessment.id);
    // The citation is retained, marked invalid — never silently detached.
    expect(invalidated.sourceAssessmentId).toBe(assessment.id);
  });

  it("cascades owned data when a student is deleted", async () => {
    const student = await insertUser("student@primer.test", "student");
    const [profile] = await db!
      .insert(learningProfiles)
      .values({ studentId: student.id, subjects: ["math.money"] })
      .returning();
    await db!
      .insert(profileEntries)
      .values({ profileId: profile.id, kind: "gap", detail: "struggled with making change" });
    await db!.insert(accessibilityPrefs).values({ userId: student.id, captionsEnabled: true });
    await db!
      .insert(progressEvents)
      .values({ studentId: student.id, kind: "milestone_reached", summary: "first session" });

    await db!.delete(users).where(sql`${users.id} = ${student.id}`);

    for (const table of [learningProfiles, profileEntries, accessibilityPrefs, progressEvents]) {
      const rows = await db!.select().from(table);
      expect(rows, getTableNameOf(table)).toHaveLength(0);
    }
  });
});

function getTableNameOf(table: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
  return (table as { name?: string }).name ?? String(table);
}
