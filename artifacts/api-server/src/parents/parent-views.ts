import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  assessments,
  guardianLinks,
  learningProfiles,
  profileEntries,
  sessionTurns,
  tutoringSessions,
  users,
} from "@workspace/db/schema";
import {
  MasteryLevel,
  ProfileEntryKind,
  type AtHomeActivity,
  type ParentMasteryOverview,
  type ParentSessionSummary,
  type ParentSubjectMastery,
} from "@workspace/api-zod";

/**
 * Parent-view data (spec §6.9): consent-gated reads for the parent
 * dashboard. Every derivation here is a pure function over stored rows —
 * mastery levels come from non-revoked assessments, activity suggestions
 * quote the record that motivates them, and session summaries carry turn
 * counts, never turn content. Nothing in this module mutates student state.
 */

/** Lowest → highest mastery rungs (spec §6.3) — shared ordering for summaries. */
const RUNGS = [
  MasteryLevel.memorization,
  MasteryLevel.recognition,
  MasteryLevel.comprehension,
  MasteryLevel.application,
  MasteryLevel.mastery,
] as const;

/** One roster row: a linked student's minimal identity plus the link state. */
export interface ParentRosterRow {
  student: { id: string; email: string; displayName: string };
  linkStatus: "pending" | "granted" | "revoked";
}

/** Assessment evidence the activity derivation may reason over. */
export interface ActivityAssessmentRow {
  subject: string;
  level: (typeof MasteryLevel)[keyof typeof MasteryLevel];
  evidenceNote: string;
  createdAt: Date;
}

/** Live (non-invalidated) profile entry as the derivation input. */
export interface ActivityEntryRow {
  id: string;
  kind: (typeof ProfileEntryKind)[keyof typeof ProfileEntryKind];
  subject: string | null;
  detail: string;
}

/** Everything the at-home activity derivation sees — the student's own record. */
export interface ActivityRecord {
  /** The student's explicitly chosen subjects (may be empty). */
  profileSubjects: string[];
  entries: ActivityEntryRow[];
  assessmentRows: ActivityAssessmentRow[];
}

export interface ParentViewDataPort {
  /** Roster rows for the caller's guardian links, display-name order. */
  listLinkedStudents(parentId: string): Promise<ParentRosterRow[]>;
  /** Evidence-backed mastery overview; undefined when the student row is gone. */
  masteryOverview(studentId: string): Promise<ParentMasteryOverview | undefined>;
  /** Session summaries (metadata + turn counts, no content), newest activity first. */
  sessionSummaries(studentId: string, limit: number): Promise<ParentSessionSummary[]>;
  /** The student's record as the at-home activity derivation input. */
  activityRecord(studentId: string): Promise<ActivityRecord>;
}

/**
 * Build one subject's mastery summary from its evidence rows (newest first).
 * highestLevel is the highest rung with at least one row — never an average,
 * never an invention; counts are per-rung evidence.
 */
export function summarizeSubjectMastery(
  subject: string,
  rows: ActivityAssessmentRow[],
): ParentSubjectMastery {
  const counts = Object.fromEntries(RUNGS.map((rung) => [rung, 0])) as Record<
    (typeof MasteryLevel)[keyof typeof MasteryLevel],
    number
  >;
  let highestLevel: ParentSubjectMastery["highestLevel"] = null;
  for (const rung of RUNGS) {
    counts[rung] = rows.filter((row) => row.level === rung).length;
    if (counts[rung] > 0) highestLevel = rung;
  }
  return {
    subject,
    counts,
    evidenceCount: rows.length,
    highestLevel,
    // Generated zod coerces date-time fields to Date (useDates: true); the
    // wire serialization happens at response parse time.
    lastEvidenceAt: rows.length > 0 ? rows[0].createdAt : null,
  };
}

/** Group assessment rows per subject, alphabetical for stable output. */
export function groupMasteryBySubject(rows: ActivityAssessmentRow[]): ParentSubjectMastery[] {
  const bySubject = new Map<string, ActivityAssessmentRow[]>();
  for (const row of rows) {
    const existing = bySubject.get(row.subject);
    if (existing) existing.push(row);
    else bySubject.set(row.subject, [row]);
  }
  return [...bySubject.keys()].sort().map((subject) =>
    summarizeSubjectMastery(
      subject,
      (bySubject.get(subject) ?? []).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    ),
  );
}

function slugify(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Derive at-home activities from the student's own record (spec §6.9) —
 * deterministic, evidence-backed, and honest: gaps first, then
 * misconceptions, then stretch suggestions for evidenced mastery, then
 * first steps for chosen-but-unexplored subjects. Every reason quotes the
 * record that motivated it; nothing here mutates student state. Subject-less
 * entries are skipped — the activity cards are subject-scoped; the progress
 * timeline carries the rest.
 */
export function deriveAtHomeActivities(record: ActivityRecord): AtHomeActivity[] {
  const activities: AtHomeActivity[] = [];
  const gapSubjects = new Set<string>();

  // Newest entry per subject wins when several gaps exist for one subject.
  const newestGapBySubject = new Map<string, ActivityEntryRow>();
  for (const entry of record.entries) {
    if (entry.kind === ProfileEntryKind.gap && entry.subject !== null) {
      if (!newestGapBySubject.has(entry.subject)) newestGapBySubject.set(entry.subject, entry);
    }
  }
  for (const subject of [...newestGapBySubject.keys()].sort()) {
    const entry = newestGapBySubject.get(subject);
    if (!entry) continue;
    gapSubjects.add(subject);
    activities.push({
      id: `home-practice-${entry.id}`,
      title: `Practice together: ${subject}`,
      reason: entry.detail,
      subject,
    });
  }

  for (const entry of record.entries) {
    if (entry.kind === ProfileEntryKind.misconception && entry.subject !== null) {
      activities.push({
        id: `home-revisit-${entry.id}`,
        title: `Revisit ${entry.subject} with a fresh explanation`,
        reason: entry.detail,
        subject: entry.subject,
      });
    }
  }

  // Stretch: the record's strongest evidence per subject (application or
  // mastery rungs) is worth celebrating and extending at home.
  const overview = groupMasteryBySubject(record.assessmentRows);
  for (const subjectMastery of overview) {
    if (
      subjectMastery.highestLevel === MasteryLevel.application ||
      subjectMastery.highestLevel === MasteryLevel.mastery
    ) {
      const newest = record.assessmentRows.find((row) => row.subject === subjectMastery.subject);
      activities.push({
        id: `home-stretch-${slugify(subjectMastery.subject)}`,
        title: `Keep stretching: ${subjectMastery.subject}`,
        reason: newest ? `Latest evidence: ${newest.evidenceNote}` : "Evidence-backed mastery.",
        subject: subjectMastery.subject,
      });
    }
  }

  // First steps: subjects the student chose but the record has no evidence
  // for and no gap entry about — an honest invitation, not a fake summary.
  for (const subject of record.profileSubjects) {
    if (gapSubjects.has(subject)) continue;
    const hasEvidence = overview.some((entry) => entry.subject === subject);
    if (!hasEvidence) {
      activities.push({
        id: `home-start-${slugify(subject)}`,
        title: `Start exploring: ${subject}`,
        reason: `${subject} is in your child's profile, but no evidence is recorded yet — a first look together is a good step.`,
        subject,
      });
    }
  }

  return activities.slice(0, 6);
}

/**
 * Drizzle-backed port. Reads are student-scoped by construction — no query
 * here takes a caller id because authorization happens upstream in
 * `authorize()`; the port only ever sees an already-authorized student id.
 */
export function drizzleParentViewData(db: () => NodePgDatabase): ParentViewDataPort {
  return {
    async listLinkedStudents(parentId) {
      const rows = await db()
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          linkStatus: guardianLinks.status,
        })
        .from(guardianLinks)
        .innerJoin(users, eq(users.id, guardianLinks.studentId))
        .where(eq(guardianLinks.parentId, parentId))
        .orderBy(asc(users.displayName));
      return rows.map((row) => ({
        student: { id: row.id, email: row.email, displayName: row.displayName },
        linkStatus: row.linkStatus,
      }));
    },

    async masteryOverview(studentId) {
      const [student] = await db()
        .select({ id: users.id, email: users.email, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, studentId))
        .limit(1);
      if (!student) return undefined;

      const rows = await db()
        .select({
          subject: assessments.subject,
          level: assessments.level,
          evidenceNote: assessments.evidenceNote,
          createdAt: assessments.createdAt,
        })
        .from(assessments)
        .where(and(eq(assessments.studentId, studentId), isNull(assessments.revokedAt)));

      return {
        student: {
          id: student.id,
          email: student.email,
          displayName: student.displayName,
        },
        subjects: groupMasteryBySubject(rows),
      };
    },

    async sessionSummaries(studentId, limit) {
      const sessions = await db()
        .select({
          id: tutoringSessions.id,
          title: tutoringSessions.title,
          status: tutoringSessions.status,
          startedAt: tutoringSessions.startedAt,
          lastTurnAt: tutoringSessions.lastTurnAt,
          endedAt: tutoringSessions.endedAt,
        })
        .from(tutoringSessions)
        .where(eq(tutoringSessions.studentId, studentId))
        .orderBy(desc(sql`coalesce(${tutoringSessions.lastTurnAt}, ${tutoringSessions.startedAt})`))
        .limit(limit);

      const turnCounts =
        sessions.length === 0
          ? []
          : await db()
              .select({ sessionId: sessionTurns.sessionId, turns: count() })
              .from(sessionTurns)
              .where(inArray(sessionTurns.sessionId, sessions.map((session) => session.id)))
              .groupBy(sessionTurns.sessionId);
      const countBySession = new Map(
        turnCounts.map((row) => [row.sessionId, Number(row.turns)]),
      );

      return sessions.map((session) => ({
        id: session.id,
        title: session.title,
        status: session.status,
        startedAt: session.startedAt,
        lastTurnAt: session.lastTurnAt === null ? null : session.lastTurnAt.toISOString(),
        endedAt: session.endedAt === null ? null : session.endedAt.toISOString(),
        turnCount: countBySession.get(session.id) ?? 0,
      }));
    },

    async activityRecord(studentId) {
      const [profile] = await db()
        .select({ id: learningProfiles.id, subjects: learningProfiles.subjects })
        .from(learningProfiles)
        .where(eq(learningProfiles.studentId, studentId))
        .limit(1);

      // Invalidated entries are not live interpretations (spec §6.0) —
      // they never feed a parent-facing suggestion.
      const entries = profile
        ? await db()
            .select({
              id: profileEntries.id,
              kind: profileEntries.kind,
              subject: profileEntries.subject,
              detail: profileEntries.detail,
            })
            .from(profileEntries)
            .where(
              and(
                eq(profileEntries.profileId, profile.id),
                isNull(profileEntries.invalidatedAt),
              ),
            )
            .orderBy(desc(profileEntries.createdAt))
        : [];

      const assessmentRows = await db()
        .select({
          subject: assessments.subject,
          level: assessments.level,
          evidenceNote: assessments.evidenceNote,
          createdAt: assessments.createdAt,
        })
        .from(assessments)
        .where(and(eq(assessments.studentId, studentId), isNull(assessments.revokedAt)));

      return {
        profileSubjects: profile?.subjects ?? [],
        entries,
        assessmentRows,
      };
    },
  };
}
