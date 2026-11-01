// Lesson progress derivation for API responses. Position comes from the
// shared derivation (session-context.ts) — the same one providers see.

import type { DemoLesson } from "./lesson/types";
import { MASTERED_MARKER } from "./types";
import { derivePosition } from "./session-context";
import type { TutorSession } from "./session-store";

export interface ProgressShape {
  stepIndex: number;
  totalSteps: number;
  lessonComplete: boolean;
  mastered: boolean;
}

/** The step the learner is working on: the first one not yet advanced past. */
export function lessonProgress(session: TutorSession, lesson: DemoLesson): ProgressShape {
  const position = derivePosition(session.history, lesson);
  const working = lesson.steps.find((s) => !position.advancedIds.includes(s.id));

  return {
    stepIndex: working ? lesson.steps.indexOf(working) : lesson.steps.length - 1,
    totalSteps: lesson.steps.length,
    lessonComplete: lesson.steps.every((s) => position.taughtIds.includes(s.id)),
    mastered: position.advancedIds.includes(MASTERED_MARKER) || session.mastered,
  };
}

/** Last step taught but not yet advanced past — the grading target, if any. */
export function gradingStep(session: TutorSession, lesson: DemoLesson) {
  const position = derivePosition(session.history, lesson);
  return position.gradingStepId !== null ? (lesson.steps.find((s) => s.id === position.gradingStepId) ?? undefined) : undefined;
}

/** First step whose teaching has not been delivered yet, if any. */
export function nextUndeliveredStep(session: TutorSession, lesson: DemoLesson) {
  const position = derivePosition(session.history, lesson);
  return position.nextTeachId !== null ? (lesson.steps.find((s) => s.id === position.nextTeachId) ?? undefined) : undefined;
}
