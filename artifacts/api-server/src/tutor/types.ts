// Tutor provider layer ("Jake's shape", per the Primer MVP spec).
// A provider turns one learner turn into a stream of events. Providers never
// execute consequential actions — a proposed_action is only a proposal; the
// Sentinel confirmation gate in the routes owns execution.

import type { SessionContext } from "./session-context";

export type { SessionContext };

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
  /**
   * The teaching strategy that produced this message (adaptive engine, spec
   * §6.4). The no-repeat selection rule reads the last tagged message; the
   * contract's sessionTurns.strategyId persists the same value.
   */
  strategyId?: string;
}

/**
 * What the message did: delivered a step's teaching ("teach"), confirmed an
 * advance past one ("advance"), or re-presented the current step in a
 * different way ("reteach" — struggle re-teach or an explicit "explain it
 * differently"; never moves position).
 */
export type TurnMessageKind = "teach" | "advance" | "reteach";

/** Tag for the tutor message appended after a mastered-marking confirmation. */
export const MASTERED_MARKER = "lesson:mastered";

export type TurnEvent =
  | {
      type: "text";
      delta: string;
      stepId?: string;
      kind?: TurnMessageKind;
      strategyId?: string; // teaching strategy that produced this text (spec §6.4)
    } // full-detail reply (spoken short version carried in done)
  | { type: "proposed_action"; action: ProposedAction; checkLine: string }
  | { type: "done"; spoken: string }; // short spoken text — full detail is on screen

/**
 * One tutoring turn. Session state is explicit: providers receive a
 * SessionContext (history, lesson, learner input, and derived position)
 * instead of re-deriving position from raw history — one derivation,
 * shared by every provider and the progress API.
 */
export interface TutorProvider {
  /** Free-form identifier — known selection lives in provider/index.ts; test
   * doubles and the Gemma-local launch provider use their own names. */
  readonly name: string;
  turn(ctx: SessionContext): AsyncIterable<TurnEvent>;
}

/** A proposed action parked on the session until /confirm executes or clears it. */
export interface PendingAction {
  action: ProposedAction;
  checkLine: string;
}
