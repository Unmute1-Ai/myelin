// Retention controls on learner data (spec §6.11: "retention controls on
// profile data"). The rules below are derived from the verified schema
// (lib/db/src/schema/tutoring.ts), not invented policy:
//
//   - The student's own DELETE /sessions/:id is the primary erasure path:
//     the session row is hard-deleted and turns/materials cascade. The sweep
//     adds the AGE dimension: completed sessions idle past the window are
//     erased on the same path.
//   - Evidence protection outranks retention. A profile entry citing a turn
//     (profile_entries.source_turn_id, ON DELETE RESTRICT) blocks the session
//     delete with PostgreSQL 23503 — the sweep SKIPS that session and counts
//     the skip. §6.0's "no entry ever cites a ghost" wins over the window.
//   - Mastery evidence survives: assessments.session_id is ON DELETE SET
//     NULL, so sweeping a session never erases what the student demonstrated
//     — only the conversation around it.
//   - Tombstones are not content-expirable: revoked turns/assessments and
//     invalidated profile entries keep their text for audit by design
//     (§6.0). The sweep never redacts them.
//   - Append-only tables (audit_log, progress_events), users, consents, and
//     guardian links are out of the sweep's reach entirely.
//
// The sweep reports counts only — learner content (turn text, material text,
// profile details) is never logged, even as a count of characters.

import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { guardianLinks, tutoringSessions, users } from "@workspace/db/schema";
import type { AuditPort } from "../auth/audit";

/** One run of the retention sweep, reported to the audit trail (counts only). */
export interface RetentionResult {
  /** Completed sessions erased (turns and materials went with them, by cascade). */
  sessionsDeleted: number;
  /** Sessions skipped because cited evidence is still attached (§6.0 protection). */
  sessionsSkippedCited: number;
}

/** PG foreign-key-violation code — what a RESTRICT delete attempt reports. */
const FK_VIOLATION = "23503";

function isPgCode(error: unknown, code: string): boolean {
  const candidates = [
    error as { code?: string } | undefined,
    (error as { cause?: { code?: string } }).cause,
  ];
  return candidates.some((candidate) => candidate?.code === code);
}

/**
 * Erase expired learner content. A session is expired when it is completed
 * and its last activity (`lastTurnAt`, falling back to `startedAt`) is older
 * than `windowDays`. Each candidate is deleted individually so one
 * evidence-cited session cannot abort the batch; a RESTRICT rejection is a
 * skip, not an error. The run is audited when an AuditPort is provided —
 * the trail row carries counts, never content.
 */
export async function runRetentionSweep<TSchema extends Record<string, unknown>>(
  db: NodePgDatabase<TSchema>,
  windowDays = 30,
  audit?: AuditPort,
): Promise<RetentionResult> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const candidates = await db
    .select({ id: tutoringSessions.id })
    .from(tutoringSessions)
    .where(
      and(
        eq(tutoringSessions.status, "completed"),
        lt(sql`coalesce(${tutoringSessions.lastTurnAt}, ${tutoringSessions.startedAt})`, cutoff),
      ),
    )
    .orderBy(desc(sql`coalesce(${tutoringSessions.lastTurnAt}, ${tutoringSessions.startedAt})`))
    .limit(500);

  let sessionsDeleted = 0;
  let sessionsSkippedCited = 0;
  for (const candidate of candidates) {
    try {
      // Turns and materials cascade (schema FKs); a profile entry citing a
      // turn of this session throws 23503 and the session survives.
      await db.delete(tutoringSessions).where(eq(tutoringSessions.id, candidate.id));
      sessionsDeleted += 1;
    } catch (error) {
      if (isPgCode(error, FK_VIOLATION)) {
        sessionsSkippedCited += 1;
        continue;
      }
      throw error; // unknown storage failure — surface it, never swallow it
    }
  }

  if (audit) {
    await audit.record({
      actorId: null, // system-run sweep; the invoking operator context, when any, is the caller's
      action: "retention_sweep_executed",
      resourceType: "tutoring_sessions",
      resourceId: null,
      decision: "allowed",
      authorizationEvidence: { windowDays },
      metadata: {
        sessionsDeleted,
        sessionsSkippedCited,
        candidatesConsidered: candidates.length,
      },
    });
  }

  return { sessionsDeleted, sessionsSkippedCited };
}

/**
 * Accounts that never became learners — no session, no guardian link, older
 * than the dormancy window. A named, read-only check: the platform does not
 * delete users autonomously; the count feeds an operator's erasure run,
 * which then goes through the audited user-deletion path.
 */
export async function countDormantAccounts<TSchema extends Record<string, unknown>>(
  db: NodePgDatabase<TSchema>,
  dormancyDays = 365,
): Promise<number> {
  const cutoff = new Date(Date.now() - dormancyDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(
      and(
        lt(users.createdAt, cutoff),
        sql`NOT EXISTS (SELECT 1 FROM ${tutoringSessions} s WHERE s.student_id = ${users.id})`,
        sql`NOT EXISTS (SELECT 1 FROM ${guardianLinks} g WHERE g.parent_id = ${users.id} OR g.student_id = ${users.id})`,
      ),
    );
  return rows[0]?.count ?? 0;
}

/**
 * The sweep's declared hands-off set — tables retention may never erase.
 * Kept as a named export so the retention tests can assert the boundary.
 */
export const RETENTION_EXEMPT_TABLES = [
  "audit_log", // append-only trail (§6.11) — accountability outlives the window
  "progress_events", // append-only timeline (§5)
  "profile_entries", // evidence-governed lifecycle (§6.0), including invalidated tombstones
  "assessments", // mastery evidence survives sessions (session_id SET NULL)
  "users",
  "consents",
  "guardian_links",
  "learning_profiles",
  "accessibility_prefs",
] as const;
