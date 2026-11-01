// Sentinel execution — the ONE place a confirmed consequential action takes
// effect. The routes call it on POST /confirm with accepted:true; the eval
// harness calls it to mirror the route exactly, so the suite exercises the
// real execution semantics, not a re-implementation.

import type { DemoLesson } from "./lesson/types";
import { MASTERED_MARKER, type PendingAction } from "./types";
import { gradingStep, nextUndeliveredStep } from "./progress";
import type { SessionStore, TutorSession } from "./session-store";

export interface ExecutedActionReply {
  content: string;
  spoken: string;
}

/**
 * Execute a confirmed pending action against the session: advance the
 * grading target (delivering the next step's teaching), mark the lesson
 * mastered, or acknowledge practice. The caller owns the HTTP response.
 */
export function executeConfirmedAction(
  store: SessionStore,
  session: TutorSession,
  lesson: DemoLesson,
  pending: PendingAction,
): ExecutedActionReply {
  if (pending.action === "advance_step") {
    const current = gradingStep(session, lesson);
    if (current !== undefined) store.markAdvanced(session, current.id);

    const next = nextUndeliveredStep(session, lesson);
    if (next !== undefined) {
      store.markTaught(session, next.id);
      return {
        content: `On we go.\n\n${next.teaching}\n\n${next.check.question}`,
        spoken: `On we go. ${next.spoken}`,
      };
    }
    return {
      content: "That was the last step — say the word if you'd like me to mark the lesson mastered.",
      spoken: "That was the last step. Nice work.",
    };
  }

  if (pending.action === "mark_mastered") {
    store.markAdvanced(session, MASTERED_MARKER);
    return {
      content: "Marked mastered. Nothing is saved once this session ends — close the tab whenever you like.",
      spoken: "Marked mastered. Nice work today.",
    };
  }

  // assign_practice has no MVP surface — acknowledging is the honest response.
  return {
    content: "Practice comes with a later version — nothing to assign just yet.",
    spoken: "Practice comes with a later version.",
  };
}
