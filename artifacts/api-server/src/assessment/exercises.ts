// Gap detection and targeted exercise selection (spec §6.3: "Exercises
// target detected gaps"). Gaps come from assessment evidence only — the same
// rows the mastery rule produces — never from vibes. Pure functions over
// rows; callers (dashboards, the adaptive engine, the sessions flow) own IO.
import type { Assessment } from "@workspace/db/schema";
import { MasteryLevel } from "@workspace/api-zod";

/** The gap shapes detectGaps can produce — strategies weigh the shape, not the wording. */
export type LearningGapKind = "recall_plateau" | "comprehension_stall" | "stale_evidence";

/** One detected learning gap, with a human-readable reason for the UI. */
export interface LearningGap {
  subject: string;
  skill: string | null;
  reason: string;
  /** 0..1 — drives selection order when several gaps compete. */
  strength: number;
  /** Which evidence pattern produced this gap. */
  kind: LearningGapKind;
}

export interface DetectGapsOptions {
  /** Injectable clock for the staleness rule; defaults to now. */
  now?: Date;
}

const RECALL_PLATEAU_MIN_ATTEMPTS = 3;
const COMPREHENSION_STALL_MIN_INDEPENDENT = 2;
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

function groupKey(row: Pick<Assessment, "subject" | "skill">): string {
  return `${row.subject}::${row.skill ?? ""}`;
}

function gapForGroup(group: Assessment[], now: Date): LearningGap | null {
  const recallRows = group.filter((row) => row.evidenceKind === "recall");
  const independent = group.filter((row) => row.evidenceKind !== "recall");
  const { subject, skill } = group[0];
  const label = skill ? `${subject} · ${skill}` : subject;
  const latestAt = Math.max(...group.map((row) => row.createdAt.getTime()));

  // 1. Recall plateau: repeated correct answers on practiced problems, but
  //    independent application never happened. The classic memorized-but-
  //    not-understood pattern — feed it novel application practice.
  if (independent.length === 0 && recallRows.length >= RECALL_PLATEAU_MIN_ATTEMPTS) {
    return {
      subject,
      skill,
      reason: `${recallRows.length} correct answers on practiced problems, but no independent application yet — practice a novel problem.`,
      strength: 0.8,
      kind: "recall_plateau",
    };
  }

  // 2. Comprehension stall: independent evidence exists but never advanced
  //    past comprehension — consistent application isn't there yet.
  if (
    independent.length >= COMPREHENSION_STALL_MIN_INDEPENDENT &&
    independent.every((row) => row.level === MasteryLevel.comprehension)
  ) {
    return {
      subject,
      skill,
      reason: `Independent application shown in ${label}, but not yet consistent — practice toward fluency.`,
      strength: 0.5,
      kind: "comprehension_stall",
    };
  }

  // 3. Stale evidence: mastery decays; an old record deserves a fresh check
  //    before dashboards keep advertising it.
  if (now.getTime() - latestAt > STALE_AFTER_MS) {
    return {
      subject,
      skill,
      reason: `No fresh evidence in ${label} for over 30 days — refresh with a new check.`,
      strength: 0.4,
      kind: "stale_evidence",
    };
  }

  return null;
}

/** Detect gaps from assessment rows only — one gap per subject+skill group. */
export function detectGaps(rows: readonly Assessment[], options: DetectGapsOptions = {}): LearningGap[] {
  const now = options.now ?? new Date();
  const groups = new Map<string, Assessment[]>();
  for (const row of rows) {
    const key = groupKey(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const gaps: LearningGap[] = [];
  for (const group of groups.values()) {
    const gap = gapForGroup(group, now);
    if (gap) gaps.push(gap);
  }
  return gaps.sort(
    (a, b) =>
      b.strength - a.strength ||
      a.subject.localeCompare(b.subject) ||
      (a.skill ?? "").localeCompare(b.skill ?? ""),
  );
}

/** A bank exercise the selector can aim at a gap. Lesson-agnostic on purpose. */
export interface TargetedExercise {
  id: string;
  subject: string;
  skill: string | null;
}

export interface SelectExercisesOptions {
  /** The exercise the learner just attempted — never selected again (no-repeat). */
  previousExerciseId?: string;
  /** Cap on returned exercises; default 3. */
  limit?: number;
}

/**
 * Pick exercises that target the detected gaps: strongest gap first, a
 * skill-level gap is served by exactly that skill's exercises, a subject-level
 * gap by any exercise in the subject — no repeats, no forcing when the bank
 * has nothing that matches.
 */
export function selectExercises(
  gaps: readonly LearningGap[],
  bank: readonly TargetedExercise[],
  options: SelectExercisesOptions = {},
): TargetedExercise[] {
  const limit = options.limit ?? 3;
  const excluded = new Set(options.previousExerciseId ? [options.previousExerciseId] : []);
  const chosen: TargetedExercise[] = [];
  const taken = new Set<string>();

  for (const gap of gaps) {
    const matches = bank.filter(
      (exercise) =>
        exercise.subject === gap.subject &&
        !taken.has(exercise.id) &&
        !excluded.has(exercise.id) &&
        // A skill-level gap wants exactly that skill; a subject-level gap
        // accepts any exercise in the subject.
        (gap.skill === null || exercise.skill === gap.skill),
    );

    for (const exercise of matches) {
      if (chosen.length >= limit) return chosen;
      chosen.push(exercise);
      taken.add(exercise.id);
    }
  }
  return chosen;
}
