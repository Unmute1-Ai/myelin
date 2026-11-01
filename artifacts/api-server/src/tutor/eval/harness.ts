// Eval harness driver. ProviderDriver mirrors the tutor routes' contract —
// same session-context construction, same turn recording, same Sentinel
// execution (through the shared executeConfirmedAction) — so a scenario
// exercises exactly what a learner's API session would, minus HTTP.

import type { DemoLesson } from "../lesson/types";
import { DEMO_LESSON } from "../lesson/money-math";
import { executeConfirmedAction } from "../confirm";
import { lessonProgress, type ProgressShape } from "../progress";
import { buildSessionContext } from "../session-context";
import { SessionStore, type TutorSession } from "../session-store";
import type { PendingAction, TurnMessage, TutorProvider } from "../types";

/** One recorded learner turn (route-shaped, minus HTTP). */
export interface TranscriptTurn {
  input: string;
  reply: string;
  spoken: string;
  proposedAction: PendingAction["action"] | null;
  checkLine: string | null;
  /** Step id / kind carried on the tutor text message (position markers). */
  stepId: string | null;
  kind: TurnMessage["kind"] | null;
}

export interface ConfirmResult {
  executed: boolean;
  reply: string | null;
  progress: ProgressShape;
}

/** Drives one provider through a scenario, mirroring routes/tutor.ts. */
export class ProviderDriver {
  private readonly store = new SessionStore();
  private readonly session: TutorSession;

  /** Learner turns issued so far — eval reports carry it, never timestamps. */
  turnCount = 0;

  constructor(
    private readonly provider: TutorProvider,
    private readonly lesson: DemoLesson = DEMO_LESSON,
  ) {
    this.session = this.store.create();
  }

  get progress(): ProgressShape {
    return lessonProgress(this.session, this.lesson);
  }

  /** One learner turn: build context, run the provider, record like the route does. */
  async turn(input: string): Promise<TranscriptTurn> {
    this.turnCount += 1;
    let reply: { content: string; stepId?: string; kind?: TurnMessage["kind"] } | null = null;
    let spoken = "";
    let pending: PendingAction | null = null;

    const ctx = buildSessionContext(this.session.history, this.lesson, input);
    for await (const event of this.provider.turn(ctx)) {
      if (event.type === "text") {
        reply = { content: event.delta, stepId: event.stepId, kind: event.kind };
      } else if (event.type === "done") {
        spoken = event.spoken;
      } else {
        pending = { action: event.action, checkLine: event.checkLine };
      }
    }

    if (reply === null) {
      throw new Error(`provider "${this.provider.name}" returned no text event for input "${input}"`);
    }

    // Route recording: the tutor text message carries the position markers
    // verbatim; a proposal parks on the session — it never executes on its own.
    this.store.pushTurn(this.session, input, {
      role: "tutor",
      content: reply.content,
      stepId: reply.stepId,
      kind: reply.kind,
    });
    if (pending !== null) this.store.setPendingAction(this.session, pending);

    return {
      input,
      reply: reply.content,
      spoken,
      proposedAction: pending !== null ? pending.action : null,
      checkLine: pending !== null ? pending.checkLine : null,
      stepId: reply.stepId ?? null,
      kind: reply.kind ?? null,
    };
  }

  /** POST /confirm mirror: decline clears, accept executes exactly once. */
  confirm(accepted: boolean): ConfirmResult {
    const progress = this.progress;
    if (!accepted) {
      this.store.clearPendingAction(this.session);
      return { executed: false, reply: "Okay — we'll stay right here.", progress };
    }
    const executed = this.store.consumeConfirmed(this.session, true);
    if (executed === null) return { executed: false, reply: null, progress };
    const reply = executeConfirmedAction(this.store, this.session, this.lesson, executed);
    return { executed: true, reply: reply.content, progress: this.progress };
  }

  /** Sentinel regression canary for scenarios: nothing may auto-execute. */
  get pending(): PendingAction | null {
    return this.session.pendingAction;
  }
}
