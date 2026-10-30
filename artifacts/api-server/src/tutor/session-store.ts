// In-memory tutor session store. Session-only by locked privacy decision:
// history, current step, and any pending action live here and die with the
// process — no DATABASE_URL anywhere in the tutor path, nothing on disk.
//
// The store owns the Sentinel execution rule: a proposed action becomes
// pending exactly once, and consumeConfirmed() hands it to the caller only
// on an explicit typed confirmation — spoken or text assent in a turn can
// never execute anything.

import { MASTERED_MARKER, type PendingAction, type TurnMessage } from "./types";

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // ~2h, per spec
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export interface TutorSession {
  readonly id: string;
  readonly createdAt: number;
  /** Bumped on every mutation so TTL measures activity, not creation. */
  lastActiveAt: number;
  history: TurnMessage[];
  /** Sentinel pending state: proposed but NOT executed. At most one at a time. */
  pendingAction: PendingAction | null;
  /** True when the wrap-up proposal was accepted and executed. */
  mastered: boolean;
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`No tutor session ${sessionId}`);
  }
}

export class SessionStore {
  private readonly sessions = new Map<string, TutorSession>();
  private readonly sweep: ReturnType<typeof setInterval>;

  constructor(now: () => number = Date.now) {
    this.now = now;
    this.sweep = setInterval(() => this.sweepExpired(), SWEEP_INTERVAL_MS);
    this.sweep.unref?.();
  }

  private readonly now: () => number;

  create(): TutorSession {
    const id = crypto.randomUUID();
    const at = this.now();
    const session: TutorSession = { id, createdAt: at, lastActiveAt: at, history: [], pendingAction: null, mastered: false };
    this.sessions.set(id, session);
    return session;
  }

  get(sessionId: string): TutorSession {
    const session = this.sessions.get(sessionId);
    if (session === undefined || this.now() - session.lastActiveAt > SESSION_TTL_MS) {
      // Treat expired and unknown alike: one NotFound shape for the API.
      if (session !== undefined) this.sessions.delete(sessionId);
      throw new SessionNotFoundError(sessionId);
    }
    return session;
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /** Record a completed turn (learner input + tutor reply) and keep TTL fresh. */
  pushTurn(session: TutorSession, learnerInput: string, tutorReply: TurnMessage): void {
    session.history.push({ role: "learner", content: learnerInput }, tutorReply);
    session.lastActiveAt = this.now();
  }

  /** Record that a step's teaching was delivered (position marker). */
  markTaught(session: TutorSession, stepId: string): void {
    session.history.push({ role: "tutor", content: `[teaching ${stepId}]`, stepId, kind: "teach" });
    session.lastActiveAt = this.now();
  }

  /** Record a confirmed advance past a step (position marker, Sentinel-executed). */
  markAdvanced(session: TutorSession, stepId: string): void {
    session.history.push({ role: "tutor", content: `[advanced ${stepId}]`, stepId, kind: "advance" });
    if (stepId === MASTERED_MARKER) session.mastered = true;
    session.lastActiveAt = this.now();
  }

  /** Stage a proposal from the provider — overwrites any stale pending one. */
  setPendingAction(session: TutorSession, pending: PendingAction): void {
    session.pendingAction = pending;
  }

  /** Drop a pending proposal without executing it (learner declined). */
  clearPendingAction(session: TutorSession): PendingAction | null {
    const pending = session.pendingAction;
    session.pendingAction = null;
    session.lastActiveAt = this.now();
    return pending;
  }

  /**
   * The only execution path for a consequential action. Returns the pending
   * action exactly once on an explicit typed confirmation, and null
   * otherwise (nothing pending / not accepted) — spoken or text assent
   * inside a turn never reaches this.
   */
  consumeConfirmed(session: TutorSession, accepted: boolean): PendingAction | null {
    if (!accepted || session.pendingAction === null) return null;
    const pending = session.pendingAction;
    session.pendingAction = null; // exactly-once: gone even if execution fails
    session.lastActiveAt = this.now();
    return pending;
  }

  dispose(): void {
    clearInterval(this.sweep);
    this.sessions.clear();
  }

  private sweepExpired(): void {
    const now = this.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActiveAt > SESSION_TTL_MS) this.sessions.delete(id);
    }
  }
}
