/*
 * Pure derivations for the student dashboard (spec §6.7): learning
 * objectives, the evidence-backed mastery ladder, and recommended
 * activities. Named functions over contract types — no component assembles
 * this logic inline, and no function invents evidence that isn't in the
 * record.
 *
 * Ground truth about the data (verified this session): assessment progress
 * events carry level and evidenceKind but NOT subject, so no function here
 * claims subject-level mastery. Subject-linked conclusions come from
 * profile entries, which do carry subject and are evidence-governed
 * upstream (spec §6.0).
 */
import type { LearningProfile, ProfileEntry, ProgressEvent, TutoringSession } from "@workspace/api-zod";
import { MasteryLevel, ProfileEntryKind, ProgressEventKind, SessionStatus } from "@workspace/api-zod";

/** Lowest → highest mastery rungs (spec §6.3); the ladder renders in order. */
export const MASTERY_LADDER = [
  MasteryLevel.memorization,
  MasteryLevel.recognition,
  MasteryLevel.comprehension,
  MasteryLevel.application,
  MasteryLevel.mastery,
] as const;

export type MasteryRung = (typeof MASTERY_LADDER)[number];

function isMasteryLevel(value: unknown): value is MasteryLevel {
  return typeof value === "string" && value in MasteryLevel;
}

/** One evidence-backed mastery data point: a recorded assessment event. */
export interface MasteryEvidence {
  eventId: string;
  /** The assessment this evidence cites (payload.assessmentId, when present). */
  assessmentId: string | null;
  level: MasteryLevel;
  evidenceKind: string | null;
  summary: string;
  createdAt: string;
}

/** The mastery ladder: counts per rung plus the newest evidence points. */
export interface MasteryLadder {
  counts: Record<MasteryRung, number>;
  evidence: MasteryEvidence[];
}

/**
 * Build the mastery ladder from assessment events, newest first. Events
 * without a parseable level in their payload are skipped, never guessed —
 * a malformed payload must not invent a rung the learner never earned.
 */
export function deriveMasteryLadder(events: ProgressEvent[]): MasteryLadder {
  const counts = Object.fromEntries(MASTERY_LADDER.map((rung) => [rung, 0])) as Record<
    MasteryRung,
    number
  >;
  const evidence: MasteryEvidence[] = [];

  for (const event of events) {
    if (event.kind !== ProgressEventKind.assessment_recorded) continue;
    const level = event.payload?.level;
    if (!isMasteryLevel(level)) continue;

    counts[level] += 1;
    evidence.push({
      eventId: event.id,
      assessmentId:
        typeof event.payload?.assessmentId === "string" ? event.payload.assessmentId : null,
      level,
      evidenceKind:
        typeof event.payload?.evidenceKind === "string" ? event.payload.evidenceKind : null,
      summary: event.summary,
      createdAt: new Date(event.createdAt).toISOString(),
    });
  }

  return { counts, evidence };
}

/** One learning objective: what the student is working on, and why. */
export interface LearningObjective {
  subject: string;
  /** The gap detail when a gap entry exists for this subject. */
  focus: string | null;
  /** How much evidence the record holds for this subject. */
  evidenceCount: number;
}

/**
 * Derive learning objectives from the student's explicit subjects and the
 * subject-linked gap entries (spec §6.2, §6.7). Subjects come from the
 * profile — the student's own choices — and the focus from governed gap
 * entries, so every objective is either the learner's plan or
 * evidence-governed teaching data. Never both absent and invented.
 */
export function deriveLearningObjectives(
  profile: LearningProfile,
  entries: ProfileEntry[],
): LearningObjective[] {
  const gapDetails = new Map<string, string>();
  const evidenceCounts = new Map<string, number>();

  for (const entry of entries) {
    if (!entry.subject) continue;
    evidenceCounts.set(entry.subject, (evidenceCounts.get(entry.subject) ?? 0) + 1);
    if (entry.kind === ProfileEntryKind.gap && !gapDetails.has(entry.subject)) {
      gapDetails.set(entry.subject, entry.detail);
    }
  }

  // Profile subjects first (explicit choices), then any subject that only
  // appears through evidence — nothing the record knows about is hidden.
  const subjects = [...new Set([...profile.subjects, ...evidenceCounts.keys()])];

  return subjects.map((subject) => ({
    subject,
    focus: gapDetails.get(subject) ?? null,
    evidenceCount: evidenceCounts.get(subject) ?? 0,
  }));
}

/** One recommended activity, derived from real record data. */
export interface ActivityRecommendation {
  id: string;
  title: string;
  /** Why the record suggests this — quoted from the entry that motivated it. */
  reason: string;
}

/**
 * Recommend activities from the transparent record (spec §6.7): practice for
 * gap subjects, a differently-explained pass for known misconceptions, and
 * first steps for subjects with no evidence yet. Preferences are never
 * recommendations — they are already honored (spec §6.4).
 */
export function deriveRecommendations(
  profile: LearningProfile,
  entries: ProfileEntry[],
): ActivityRecommendation[] {
  const recommendations: ActivityRecommendation[] = [];
  const seenSubjects = new Set<string>();

  for (const entry of entries) {
    if (entry.kind === ProfileEntryKind.gap && entry.subject && !seenSubjects.has(entry.subject)) {
      seenSubjects.add(entry.subject);
      recommendations.push({
        id: `gap-${entry.id}`,
        title: `Practice: ${entry.subject}`,
        reason: entry.detail,
      });
    }
    if (entry.kind === ProfileEntryKind.misconception && entry.subject) {
      recommendations.push({
        id: `misconception-${entry.id}`,
        title: `Try a different explanation: ${entry.subject}`,
        reason: entry.detail,
      });
    }
  }

  if (recommendations.length === 0 && profile.subjects.length > 0) {
    // The record holds no gaps yet — invite the first step honestly.
    recommendations.push({
      id: "start-first",
      title: `Start exploring: ${profile.subjects[0]}`,
      reason: "You picked this subject — jump in and see what you know.",
    });
  }

  return recommendations.slice(0, 3);
}

/** The most recent still-active session, for continue-learning resume. */
export function findResumeSession(sessions: TutoringSession[]): TutoringSession | null {
  const active = sessions.filter((s) => s.status === SessionStatus.active);
  if (active.length === 0) return null;
  // Recency by last tutor activity — lastTurnAt (ISO string) when present,
  // else the session's own start. getTime() compares the two kinds fairly.
  return [...active].sort(
    (a, b) =>
      new Date(b.lastTurnAt ?? b.startedAt).getTime() -
      new Date(a.lastTurnAt ?? a.startedAt).getTime(),
  )[0];
}
