// Scripted provider — the deterministic default. Drives the demo lesson from
// the lesson module with no network and no API key, so tests, CI, and UI
// dogfooding never block on a cloud credential.
//
// Position derives from tutor-message tags in the history (kind="teach" /
// kind="advance"; see session-store.ts): the grading target is the last
// taught-but-not-advanced step. Same input in the same position always yields
// the same output — deterministic by contract.

import type { DemoLesson, LessonStep } from "../lesson/types";
import { answerMatches } from "../lesson/grade";
import { MASTERED_MARKER, type TurnEvent, type TurnMessage, type TutorProvider } from "../types";

/** Sentinel one-line check for advancing (prompt phrasing, "I heard this as: …"). */
export function advanceCheckLine(): string {
  return "I heard this as: you've got this concept — ready to move to the next one?";
}

/** Sentinel one-line check for marking the lesson mastered. */
export function masteredCheckLine(lesson: DemoLesson): string {
  return `I heard this as: ${lesson.title} is yours — ready for me to mark it mastered?`;
}

function taughtIds(history: TurnMessage[]): Set<string> {
  return new Set(history.filter((m) => m.role === "tutor" && m.kind === "teach" && m.stepId !== undefined).map((m) => m.stepId!));
}

function advancedIds(history: TurnMessage[]): Set<string> {
  return new Set(history.filter((m) => m.role === "tutor" && m.kind === "advance" && m.stepId !== undefined).map((m) => m.stepId!));
}

export function createScriptedProvider(): TutorProvider {
  return {
    name: "scripted",

    async *turn(history: TurnMessage[], lesson: DemoLesson, input: string): AsyncIterable<TurnEvent> {
      const taught = taughtIds(history);
      const advanced = advancedIds(history);
      const nextTeach = lesson.steps.find((s) => !taught.has(s.id));
      const gradingStep = [...lesson.steps]
        .reverse()
        .find((s) => taught.has(s.id) && !advanced.has(s.id));

      // Opening turn: greet, then deliver the first step — whatever the
      // learner typed to get here ("type however you like").
      if (nextTeach && taught.size === 0) {
        yield {
          type: "text",
          kind: "teach",
          stepId: nextTeach.id,
          delta:
            "Hey — I'm Primer. We type however we like here; I work with what you mean, not how it's spelled.\n\n" +
            `Let's look at money.\n\n${nextTeach.teaching}\n\n${nextTeach.check.question}`,
        };
        yield { type: "done", spoken: `Hey, I'm Primer. ${nextTeach.spoken} ${nextTeach.check.question}` };
        return;
      }

      // Mid-step: grade the current check by meaning.
      if (gradingStep) {
        yield* gradeAttempt(gradingStep, input);
        return;
      }

      // Between steps (fallback — confirm normally delivers the next teaching).
      if (nextTeach) {
        yield {
          type: "text",
          kind: "teach",
          stepId: nextTeach.id,
          delta: `Let's look at money.\n\n${nextTeach.teaching}\n\n${nextTeach.check.question}`,
        };
        yield { type: "done", spoken: `${nextTeach.spoken} ${nextTeach.check.question}` };
        return;
      }

      // All steps advanced: propose the mastered marking, or wrap up after it.
      if (!advanced.has(MASTERED_MARKER)) {
        yield {
          type: "text",
          delta:
            "That's the whole lesson — coins counted, change made. Say the word if you'd like me to mark it mastered.",
        };
        yield { type: "proposed_action", action: "mark_mastered", checkLine: masteredCheckLine(lesson) };
        yield { type: "done", spoken: "That's the whole lesson. Nice work." };
        return;
      }

      yield {
        type: "text",
        delta:
          "This lesson's yours now. Nothing here is saved once the session ends — close the tab whenever, and come back anytime.",
      };
      yield { type: "done", spoken: "All set — nice work." };
    },
  };
}

/** Grade one attempt at a step's check: celebrate meaning, never grammar. */
function* gradeAttempt(step: LessonStep, input: string): Generator<TurnEvent> {
  if (answerMatches(input, step.check.acceptedNumbers)) {
    yield {
      type: "text",
      delta: `${step.check.onCorrect}\n\nTap Confirm to move on whenever you're ready.`,
    };
    yield { type: "proposed_action", action: "advance_step", checkLine: advanceCheckLine() };
    yield { type: "done", spoken: step.check.onCorrect };
    return;
  }

  // No answer in yet: another look at the worked example — same warmth, no
  // grammar commentary, never a repeat request.
  yield {
    type: "text",
    delta: `${step.check.stuckReply}\n\n${step.teaching}\n\n${step.check.question}`,
  };
  yield { type: "done", spoken: step.check.stuckReply };
}
