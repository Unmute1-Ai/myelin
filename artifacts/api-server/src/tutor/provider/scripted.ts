// Scripted provider — the deterministic default. Drives the demo lesson from
// the lesson module with no network and no API key, so tests, CI, and UI
// dogfooding never block on a cloud credential.
//
// Position comes from the shared session context (derivePosition) — the same
// derivation the routes and the eval harness use. Re-presentations (learner
// struggles, or an explicit "explain it differently") mark themselves as
// "reteach" in history and alternate the worked example with the step's
// alternate teaching, so consecutive attempts never read identically — same
// input in the same position still yields the same output, deterministic by
// contract.

import type { DemoLesson, LessonStep } from "../lesson/types";
import { answerMatches } from "../lesson/grade";
import { reteachCount } from "../session-context";
import { MASTERED_MARKER, type SessionContext, type TurnEvent, type TutorProvider } from "../types";

/** Sentinel one-line check for advancing (prompt phrasing, "I heard this as: …"). */
export function advanceCheckLine(): string {
  return "I heard this as: you've got this concept — ready to move to the next one?";
}

/** Sentinel one-line check for marking the lesson mastered. */
export function masteredCheckLine(lesson: DemoLesson): string {
  return `I heard this as: ${lesson.title} is yours — ready for me to mark it mastered?`;
}

/**
 * Learner asked for the same idea in a different way. Meaning-first: these
 * phrasings are re-explain requests — never treated as grammar complaints,
 * never a stall.
 */
export function asksForDifferentApproach(input: string): boolean {
  return /\b(explain (it|that|this) differently|say (it|that) differently|another (way|angle|example)|different (way|angle|example|approach)|one more way)\b/i.test(
    input,
  );
}

/** Rotating openers so consecutive re-teaches never read identically. */
const RETEACH_FRAMINGS: readonly string[] = [
  "No rush — let's take another look.",
  "Let's try this from a different angle.",
  "One more way in:",
];

/**
 * Worked-example body for re-presentations. Odd attempts (the first struggle
 * or ask of a step) alternate away from what the learner just saw: a struggle
 * re-shows the original example inside the stuck reply, an explicit ask leads
 * with the step's alternate teaching.
 */
function reTeachBody(step: LessonStep, attempt: number, askedExplicitly: boolean): string {
  const alternate = attempt % 2 === (askedExplicitly ? 1 : 0);
  return alternate ? (step.altTeaching ?? step.teaching) : step.teaching;
}

/** Explicit "explain it differently": framed, alternate-first, check question repeated. */
export function reTeachDelta(step: LessonStep, attempt: number): string {
  const framing = RETEACH_FRAMINGS[(attempt - 1) % RETEACH_FRAMINGS.length];
  const body = attempt % 2 === 1 ? (step.altTeaching ?? step.teaching) : step.teaching;
  return `${framing}\n\n${body}\n\n${step.check.question}`;
}

export function createScriptedProvider(): TutorProvider {
  return {
    name: "scripted",

    async *turn(ctx: SessionContext): AsyncIterable<TurnEvent> {
      const { history, lesson, input, position } = ctx;
      const nextTeach = position.nextTeachId !== null ? lesson.steps.find((s) => s.id === position.nextTeachId) : undefined;
      const gradingStep = position.gradingStepId !== null ? lesson.steps.find((s) => s.id === position.gradingStepId) : undefined;

      // Opening turn: greet, then deliver the first step — whatever the
      // learner typed to get here ("type however you like").
      if (nextTeach && position.taughtIds.length === 0) {
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

      // Explicit "explain it differently" on the live step: a different
      // presentation, never a repeat, and never a proposal.
      if (gradingStep && asksForDifferentApproach(input)) {
        const attempt = reteachCount(history, gradingStep.id) + 1;
        yield { type: "text", kind: "reteach", stepId: gradingStep.id, delta: reTeachDelta(gradingStep, attempt) };
        yield { type: "done", spoken: RETEACH_FRAMINGS[(attempt - 1) % RETEACH_FRAMINGS.length] };
        return;
      }

      // Mid-step: grade the current check by meaning.
      if (gradingStep) {
        yield* gradeAttempt(gradingStep, input, history);
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
      if (!position.advancedIds.includes(MASTERED_MARKER)) {
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
function* gradeAttempt(step: LessonStep, input: string, history: SessionContext["history"]): Generator<TurnEvent> {
  if (answerMatches(input, step.check.acceptedNumbers)) {
    yield {
      type: "text",
      delta: `${step.check.onCorrect}\n\nTap Confirm to move on whenever you're ready.`,
    };
    yield { type: "proposed_action", action: "advance_step", checkLine: advanceCheckLine() };
    yield { type: "done", spoken: step.check.onCorrect };
    return;
  }

  // Not an answer yet: the lesson-authored stuck reply, then the worked
  // example — alternating so consecutive struggles never read verbatim the
  // same. Same warmth, no grammar commentary, never a repeat request.
  const attempt = reteachCount(history, step.id) + 1;
  const body = reTeachBody(step, attempt, false);
  yield {
    type: "text",
    kind: "reteach",
    stepId: step.id,
    delta: `${step.check.stuckReply}\n\n${body}\n\n${step.check.question}`,
  };
  yield { type: "done", spoken: step.check.stuckReply };
}
