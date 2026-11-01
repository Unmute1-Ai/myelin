/**
 * Dev/demo seed for the PRIMER platform.
 *
 *   DATABASE_URL=postgres://... pnpm --filter @workspace/db db:seed
 *
 * Safe to re-run: existing demo users (@demo.primer) are deleted first
 * (cascades clean up link/consent/profile/session/assessment/progress/prefs
 * rows); seed-tagged audit rows are cleared so the trail stays clean too.
 *
 * Passwords are hashed with Argon2id (the same path as production auth).
 * The demo password is intentionally public and dev-only; never commit real
 * credentials. DATABASE_URL comes from the env.
 */
import { like, sql } from "drizzle-orm";
import { db, pool } from "./index";
import { hashPassword } from "./password";
import {
  accessibilityPrefs,
  assessments,
  auditLog,
  consents,
  guardianLinks,
  learningProfiles,
  profileEntries,
  progressEvents,
  sessionTurns,
  tutoringSessions,
  users,
} from "./schema";

const DEMO_DOMAIN = "demo.primer";
const SEED_TAG = "primer-seed";
// Dev/demo accounts only — the documented password for every seeded
// demo.primer user. Not a credential for any real system.
const DEMO_PASSWORD = "primer-demo-password";

async function resetDemoData() {
  await db
    .delete(users)
    .where(like(users.email, `%@${DEMO_DOMAIN}`)); // cascades to owned rows
  await db.delete(auditLog).where(sql`${auditLog.metadata} ->> 'seed' = ${SEED_TAG}`);
}

async function main() {
  await resetDemoData();

  const [educator] = await db
    .insert(users)
    .values({
      email: "educator@demo.primer",
      passwordHash: await hashPassword(DEMO_PASSWORD),
      role: "educator",
      displayName: "Ms. Rivera",
    })
    .returning();

  const [parent] = await db
    .insert(users)
    .values({
      email: "parent@demo.primer",
      passwordHash: await hashPassword(DEMO_PASSWORD),
      role: "parent",
      displayName: "Jordan's Parent",
    })
    .returning();

  const [student] = await db
    .insert(users)
    .values({
      email: "student@demo.primer",
      passwordHash: await hashPassword(DEMO_PASSWORD),
      role: "student",
      displayName: "Jordan",
    })
    .returning();

  const [link] = await db
    .insert(guardianLinks)
    .values({ parentId: parent.id, studentId: student.id, status: "granted" })
    .returning();

  await db.insert(consents).values({
    guardianLinkId: link.id,
    type: "learning_data",
    termsVersion: "v1.0",
  });

  const [profile] = await db
    .insert(learningProfiles)
    .values({
      studentId: student.id,
      subjects: ["math.money"],
      preferredStrategy: "visual",
      pacing: "standard",
    })
    .returning();

  const [session] = await db
    .insert(tutoringSessions)
    .values({ studentId: student.id, title: "Making change at the school store" })
    .returning();

  const turnRows = await db
    .insert(sessionTurns)
    .values([
      {
        sessionId: session.id,
        seq: 1,
        author: "student",
        content: "I don't get how to make change for a dollar.",
      },
      {
        sessionId: session.id,
        seq: 2,
        author: "tutor",
        content: "Let's try it step by step: 100 cents minus 65 cents...",
        strategyId: "step_by_step",
      },
      {
        sessionId: session.id,
        seq: 3,
        author: "student",
        content: "Numbers keep sliding around. Can you show me a picture?",
      },
      {
        sessionId: session.id,
        seq: 4,
        author: "tutor",
        content: "Here's a picture of the coins. Circle the ones that make 35 cents.",
        strategyId: "visual",
      },
    ])
    .returning();

  const assessmentRows = await db
    .insert(assessments)
    .values([
      {
        studentId: student.id,
        sessionId: session.id,
        turnId: turnRows[1].id,
        subject: "math.money",
        skill: "making_change",
        level: "memorization",
        evidenceKind: "recall",
        evidenceNote: "Repeated the counting-on sequence correctly when prompted.",
      },
      {
        studentId: student.id,
        sessionId: session.id,
        turnId: turnRows[3].id,
        subject: "math.money",
        skill: "making_change",
        level: "comprehension",
        evidenceKind: "application",
        evidenceNote: "Solved a novel change problem unaided after the visual explanation.",
      },
    ])
    .returning();

  await db.insert(profileEntries).values([
    {
      profileId: profile.id,
      kind: "gap",
      subject: "math.money",
      detail: "Needed two attempts to count on from 65 cents to a dollar.",
      sourceAssessmentId: assessmentRows[0].id,
    },
    {
      profileId: profile.id,
      kind: "successful_approach",
      subject: "math.money",
      detail: "Visual coin pictures made the change problem click.",
      sourceAssessmentId: assessmentRows[1].id,
      sourceTurnId: turnRows[3].id,
    },
    {
      profileId: profile.id,
      kind: "preference",
      detail: "Prefers pictures and worked examples over long text.",
    },
    {
      profileId: profile.id,
      kind: "strategy_change",
      subject: "math.money",
      detail: "Switched from step_by_step to visual for making change.",
      whyChanged: "The last two step-by-step attempts stalled; pictures worked in practice.",
    },
  ]);

  await db.insert(progressEvents).values([
    {
      studentId: student.id,
      actorId: educator.id,
      sessionId: session.id,
      kind: "assessment_recorded",
      summary: "Comprehension evidenced for making change.",
      payload: { level: "comprehension", evidenceKind: "application" },
    },
    {
      studentId: student.id,
      sessionId: session.id,
      kind: "strategy_changed",
      summary: "Tutor switched to visual strategies after step-by-step stalled.",
      payload: { from: "step_by_step", to: "visual" },
    },
  ]);

  await db.insert(accessibilityPrefs).values([
    { userId: student.id, captionsEnabled: true, textSize: "large" },
    { userId: parent.id, captionsEnabled: true },
  ]);

  await db.insert(auditLog).values([
    {
      actorId: parent.id,
      action: "view_progress",
      resourceType: "learning_profiles",
      resourceId: profile.id,
      decision: "allowed",
      authorizationEvidence: { role: "parent", guardianLinkId: link.id, status: "granted" },
      metadata: { seed: SEED_TAG },
    },
    {
      actorId: educator.id,
      action: "export_data",
      resourceType: "learning_profiles",
      resourceId: profile.id,
      decision: "denied",
      authorizationEvidence: { role: "educator", reason: "educators cannot export student data" },
      metadata: { seed: SEED_TAG },
    },
  ]);

  console.log("Seed complete:");
  console.log("  users: 3 (student, parent, educator)");
  console.log("  guardian links: 1 (granted) with 1 consent");
  console.log("  learning profiles: 1 with 4 profile entries");
  console.log(`  tutoring sessions: 1 with ${turnRows.length} turns`);
  console.log(`  assessments: ${assessmentRows.length}`);
  console.log("  progress events: 2, accessibility prefs: 2, audit rows: 2");
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error("Seed failed:", error);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
