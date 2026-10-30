// Lesson progress derivation for API responses. Position mirrors the
// provider's model: taught steps (kind="teach") and advanced steps
// (kind="advance") from the session history.

import type { DemoLesson } from "./lesson/types";
import { MASTERED_MARKER, type TurnMessage } from "./types";
import type { TutorSession } from "./session-store";

export interface ProgressShape {
  stepIndex: number;
  totalSteps: number;
  lessonComplete: boolean;
  mastered: boolean;
}

function taughtIds(history: TurnMessage[]): Set<string> {
  return new Set(history.filter((m) => m.role === "tutor" && m.kind === "teach" && m.stepId !== undefined).map((m) => m.stepId!));
}

function advancedIds(history: TurnMessage[]): Set<string> {
  return new Set(history.filter((m) => m.role === "tutor" && m.kind === "advance" && m.stepId !== undefined).map((m) => m.stepId!));
}

/** The step the learner is working on: the first one not yet advanced past. */
export function lessonProgress(session: TutorSession, lesson: DemoLesson): ProgressShape {
  const advanced = advancedIds(session.history);
  const taught = taughtIds(session.history);
  const working = lesson.steps.find((s) => !advanced.has(s.id));

  return {
    stepIndex: working ? lesson.steps.indexOf(working) : lesson.steps.length - 1,
    totalSteps: lesson.steps.length,
    lessonComplete: lesson.steps.every((s) => taught.has(s.id)),
    mastered: advanced.has(MASTERED_MARKER) || session.mastered,
  };
}

/** Last step taught but not yet advanced past — the grading target, if any. */
export function gradingStep(session: TutorSession, lesson: DemoLesson) {
  const taught = taughtIds(session.history);
  const advanced = advancedIds(session.history);
  return [...lesson.steps].reverse().find((s) => taught.has(s.id) && !advanced.has(s.id));
}

/** First step whose teaching has not been delivered yet, if any. */
export function nextUndeliveredStep(session: TutorSession, lesson: DemoLesson) {
  const taught = taughtIds(session.history);
  return lesson.steps.find((s) => !taught.has(s.id));
}
