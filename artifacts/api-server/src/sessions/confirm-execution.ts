// Persistent Sentinel execution — the planning half of POST /confirm for
// session-backed tutoring (spec §6.11). Pure: given the restored history and
// the consumed pending proposal, plan the tutor turns to store and the reply
// to send. The route persists what this returns, so execution survives
// visits and replays identically. Mirrors the MVP in-memory executor
// (tutor/confirm.ts) turn for turn — same marker conventions, same content —
// with copy that tells the persistence truth.

import type { DemoLesson } from "../tutor/lesson/types";
import { MASTERED_MARKER, type ProposedAction } from "../tutor/types";
import { derivePosition } from "../tutor/session-context";
import type { NewTutorTurn } from "./session-service";

export interface PlannedExecution {
  /** Tutor turns to store, in order (markers carry lesson position). */
  readonly turns: readonly NewTutorTurn[];
  /** Full-detail reply (on screen). */
  readonly reply: string;
  /** Short spoken version — not stored. */
  readonly spoken: string;
}

/**
 * Plan a confirmed action's effect. The pending proposal was already
 * consumed atomically by the route — a second confirm cannot reach here
 * with the same proposal.
 */
export function planConfirmedExecution(
  lesson: DemoLesson,
  history: Parameters<typeof derivePosition>[0],
  pending: { action: ProposedAction },
): PlannedExecution {
  if (pending.action === "advance_step") {
    const position = derivePosition(history, lesson);
    const current =
      position.gradingStepId !== null
        ? lesson.steps.find((s) => s.id === position.gradingStepId)
        : undefined;
    const next =
      position.nextTeachId !== null
        ? lesson.steps.find((s) => s.id === position.nextTeachId)
        : undefined;

    if (current !== undefined) {
      return withNext(current.id, next);
    }
    return withNext(null, next);
  }

  if (pending.action === "mark_mastered") {
    return {
      turns: [
        { content: `[advanced ${MASTERED_MARKER}]`, kind: "advance", stepId: MASTERED_MARKER },
        {
          content: "Marked mastered. Your progress is saved — pick this subject back up anytime.",
          kind: "advance",
          stepId: MASTERED_MARKER,
        },
      ],
      reply: "Marked mastered. Your progress is saved — pick this subject back up anytime.",
      spoken: "Marked mastered. Nice work today.",
    };
  }

  // assign_practice has no v1 surface — acknowledging is the honest response.
  return {
    turns: [
      { content: "Practice comes with a later version — nothing to assign just yet." },
    ],
    reply: "Practice comes with a later version — nothing to assign just yet.",
    spoken: "Practice comes with a later version.",
  };
}

function withNext(
  currentId: string | null,
  next: DemoLesson["steps"][number] | undefined,
): PlannedExecution {
  const turns: NewTutorTurn[] = [];
  if (currentId !== null) {
    turns.push({ content: `[advanced ${currentId}]`, kind: "advance", stepId: currentId });
  }
  if (next !== undefined) {
    // Marker carries position; the teaching text is stored as its own turn so
    // a restored session shows the lesson, not just the marker.
    turns.push({ content: `[teaching ${next.id}]`, kind: "teach", stepId: next.id });
    turns.push({
      content: `On we go.\n\n${next.teaching}\n\n${next.check.question}`,
      kind: "teach",
      stepId: next.id,
    });
    return {
      turns,
      reply: `On we go.\n\n${next.teaching}\n\n${next.check.question}`,
      spoken: `On we go. ${next.spoken}`,
    };
  }
  return {
    turns,
    reply: "That was the last step — say the word if you'd like me to mark the lesson mastered.",
    spoken: "That was the last step. Nice work.",
  };
}
