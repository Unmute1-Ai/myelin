// Tutor provider layer ("Jake's shape", per the Primer MVP spec).
// A provider turns one learner turn into a stream of events. Providers never
// execute consequential actions — a proposed_action is only a proposal; the
// Sentinel confirmation gate in the routes owns execution.

import type { DemoLesson } from "./lesson/types";

export type ProposedAction = "advance_step" | "mark_mastered" | "assign_practice";

export const PROPOSED_ACTIONS: readonly ProposedAction[] = [
  "advance_step",
  "mark_mastered",
  "assign_practice",
];

/** One message of tutor/learner conversation history handed to a provider. */
export interface TurnMessage {
  role: "tutor" | "learner";
  content: string;
  /**
   * Lesson step this tutor message delivered (session-tracked). The scripted
   * provider derives the learner's position from these tags; cloud providers
   * ignore them. Non-step lesson state (e.g. mastered) uses a marker constant.
   */
  stepId?: string;
  /** What the message did: delivered a step's teaching, or confirmed an advance past one. */
  kind?: TurnMessageKind;
}

/** Why the session recorded a tutor message (drives position derivation). */
export type TurnMessageKind = "teach" | "advance";

/** Tag for the tutor message appended after a mastered-marking confirmation. */
export const MASTERED_MARKER = "lesson:mastered";

export type TurnEvent =
  | { type: "text"; delta: string; stepId?: string; kind?: TurnMessageKind } // full-detail reply (spoken short version carried in done)
  | { type: "proposed_action"; action: ProposedAction; checkLine: string }
  | { type: "done"; spoken: string }; // short spoken text — full detail is on screen

export interface TutorProvider {
  readonly name: "scripted" | "anthropic" | "openai" | "gemini";
  turn(history: TurnMessage[], lesson: DemoLesson, input: string): AsyncIterable<TurnEvent>;
}

/** A proposed action parked on the session until /confirm executes or clears it. */
export interface PendingAction {
  action: ProposedAction;
  checkLine: string;
}
