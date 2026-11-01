// Session context — the explicit provider input. One derivation of lesson
// position from session history, shared by every provider, the progress API,
// and the eval harness, so scripted and cloud providers always see the same
// state. Pure functions only: no store, no clock.

import type { DemoLesson } from "./lesson/types";
import { MASTERED_MARKER, type TurnMessage } from "./types";

/** Where the learner stands, derived from tutor-message markers in history. */
export interface SessionPosition {
  /** Step ids whose teaching was delivered, in lesson order. */
  readonly taughtIds: readonly string[];
  /** Step ids advanced past (Sentinel-confirmed), in lesson order, plus MASTERED_MARKER when marked. */
  readonly advancedIds: readonly string[];
  /** The lesson was marked mastered. */
  readonly mastered: boolean;
  /** Last step taught but not advanced past — the one a check answer grades. */
  readonly gradingStepId: string | null;
  /** First step whose teaching has not been delivered yet. */
  readonly nextTeachId: string | null;
}

/** Everything a provider sees for one learner turn. */
export interface SessionContext {
  readonly lesson: DemoLesson;
  /** Conversation so far, in order (learner + tutor messages with position markers). */
  readonly history: readonly TurnMessage[];
  /** The learner's new input for this turn. */
  readonly input: string;
  readonly position: SessionPosition;
  /**
   * The session this turn belongs to — how the adaptive engine resolves the
   * learner's profile and evidence (spec §6.4). Absent for callers that
   * predate learner-linked sessions; those get base-provider behavior.
   */
  readonly sessionId?: string;
}

/** Count of re-presentations ("reteach" markers) recorded for one step. */
export function reteachCount(history: readonly TurnMessage[], stepId: string): number {
  return history.filter((m) => m.role === "tutor" && m.kind === "reteach" && m.stepId === stepId).length;
}

function markerIds(history: readonly TurnMessage[], kind: TurnMessage["kind"]): Set<string> {
  const ids = new Set<string>();
  for (const m of history) {
    if (m.role === "tutor" && m.kind === kind && m.stepId !== undefined) ids.add(m.stepId);
  }
  return ids;
}

/** Derive lesson position from history markers — the one place this lives. */
export function derivePosition(history: readonly TurnMessage[], lesson: DemoLesson): SessionPosition {
  const taught = markerIds(history, "teach");
  const advanced = markerIds(history, "advance");

  const taughtIds = lesson.steps.filter((s) => taught.has(s.id)).map((s) => s.id);
  const advancedIds = lesson.steps.filter((s) => advanced.has(s.id)).map((s) => s.id);
  if (advanced.has(MASTERED_MARKER)) advancedIds.push(MASTERED_MARKER);

  const gradingStep = [...lesson.steps].reverse().find((s) => taught.has(s.id) && !advanced.has(s.id));
  const nextTeach = lesson.steps.find((s) => !taught.has(s.id));

  return {
    taughtIds,
    advancedIds,
    mastered: advanced.has(MASTERED_MARKER),
    gradingStepId: gradingStep?.id ?? null,
    nextTeachId: nextTeach?.id ?? null,
  };
}

/** Build the provider input for one learner turn. */
export function buildSessionContext(
  history: readonly TurnMessage[],
  lesson: DemoLesson,
  input: string,
  sessionId?: string,
): SessionContext {
  return { lesson, history, input, position: derivePosition(history, lesson), ...(sessionId !== undefined ? { sessionId } : {}) };
}
