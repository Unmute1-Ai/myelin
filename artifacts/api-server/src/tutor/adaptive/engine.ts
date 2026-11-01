// The adaptive teaching engine (spec §6.4) — an IO shell around any
// TutorProvider. It intercepts exactly two kinds of turn and delegates
// everything else untouched:
//
//   1. The learner asks to hear it differently (the always-available override).
//   2. The learner is stuck on the live step's check (a wrong/non answer).
//
// Correct answers, opening teaching, Sentinel proposals, and wrap-up all
// reach the base provider verbatim, so the confirmation gate cannot regress
// through this layer. Strategy turns are tagged with their strategyId so the
// no-repeat rule and the persistent record (sessionTurns.strategyId) have
// data to reason over. Learner context arrives through a port — the engine
// itself never touches the database.

import type { Assessment, LearningProfile } from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { assessments, tutoringSessions } from "@workspace/db/schema";
import { detectGaps } from "../../assessment/exercises";
import { ensureProfile, recordStrategyChange } from "../../profiles/profile-service";
import { logger } from "../../lib/logger";
import { answerMatches } from "../lesson/grade";
import { asksForDifferentApproach } from "../provider/scripted";
import type { SessionContext, TurnEvent, TurnMessage, TutorProvider } from "../types";
import { STRATEGIES } from "./strategies";
import type { StrategyProfile } from "./strategies";
import { selectStrategy, type StrategySelection } from "./selector";
import { composeStrategyChange, type StrategyChangeRecord } from "./why-changed";

/** The learner context a resolved session carries — explicit profile plus their own assessment rows. */
export interface AdaptiveLearningContext {
  /** The student's explicit choices only (spec §6.2); a `null` pick means none. */
  readonly profile: StrategyProfile;
  /** Assessment evidence the student owns; gaps derive from these rows only (spec §6.3). */
  readonly assessments: readonly Assessment[];
}

/**
 * How the engine reaches the learner's profile and evidence, and how it
 * writes strategy changes through the §6.2 profile-service seam. Production
 * binds drizzleAdaptiveContextPort; tests bind fakes.
 */
export interface AdaptiveContextPort {
  /** Null when the session has no linked learner yet — the engine then delegates to base. */
  load(sessionId: string): Promise<AdaptiveLearningContext | null>;
  recordStrategyChange(sessionId: string, change: StrategyChangeRecord): Promise<void>;
}

/**
 * The inert port: no learner context anywhere. Base-provider behavior,
 * byte for byte — this is the engine's fail-safe degradation, not a feature
 * loss (the learner's lesson never blocks on a profile read).
 */
export const INERT_CONTEXT_PORT: AdaptiveContextPort = {
  load: async () => null,
  recordStrategyChange: async () => {},
};

/** LearningProfile satisfies the strategy's explicit-choices shape. */
function profileShape(profile: LearningProfile): StrategyProfile {
  return {
    preferredStrategy: profile.preferredStrategy,
    pacing: profile.pacing,
    subjects: profile.subjects,
  };
}

/** Production port: resolve the learner from the DB session row, read their own evidence. */
export function drizzleAdaptiveContextPort(db: () => NodePgDatabase): AdaptiveContextPort {
  async function studentIdFor(sessionId: string): Promise<string | null> {
    const [row] = await db()
      .select({ studentId: tutoringSessions.studentId })
      .from(tutoringSessions)
      .where(eq(tutoringSessions.id, sessionId))
      .limit(1);
    return row?.studentId ?? null;
  }

  return {
    async load(sessionId) {
      const studentId = await studentIdFor(sessionId);
      if (studentId === null) return null;
      const profile = await ensureProfile(db(), studentId);
      const rows = await db()
        .select()
        .from(assessments)
        .where(and(eq(assessments.studentId, studentId)))
        .orderBy(desc(assessments.createdAt))
        .limit(100);
      return { profile: profileShape(profile), assessments: rows };
    },
    async recordStrategyChange(sessionId, change) {
      const studentId = await studentIdFor(sessionId);
      if (studentId === null) return;
      await recordStrategyChange(db(), studentId, change);
    },
  };
}

/** The immediately-preceding strategy turn — the no-repeat rule's reference point. */
export function lastStrategyId(history: readonly TurnMessage[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message !== undefined && message.role === "tutor" && message.strategyId !== undefined) {
      return message.strategyId;
    }
  }
  return null;
}

export interface AdaptiveProviderOptions {
  /** The deterministic core (scripted in production and tests) — the engine wraps, never replaces. */
  base: TutorProvider;
  /** Learner context; defaults to inert (pure delegate). */
  port?: AdaptiveContextPort;
}

/** The live grading step, or undefined when no step is being graded this turn. */
function liveGradingStep(ctx: SessionContext) {
  return ctx.position.gradingStepId !== null ? ctx.lesson.steps.find((s) => s.id === ctx.position.gradingStepId) : undefined;
}

export function createAdaptiveProvider(options: AdaptiveProviderOptions): TutorProvider {
  const { base, port = INERT_CONTEXT_PORT } = options;

  return {
    name: `adaptive(${base.name})`,

    async *turn(ctx: SessionContext): AsyncIterable<TurnEvent> {
      const gradingStep = liveGradingStep(ctx);
      const askedForDifferent = asksForDifferentApproach(ctx.input);
      const stuck =
        gradingStep !== undefined && !askedForDifferent && !answerMatches(ctx.input, gradingStep.check.acceptedNumbers);

      // Only adaptive moments need the learner's context — and only when the
      // turn belongs to a session a port can resolve.
      if ((!askedForDifferent && !stuck) || ctx.sessionId === undefined) {
        yield* base.turn(ctx);
        return;
      }

      let context: AdaptiveLearningContext | null;
      try {
        context = await port.load(ctx.sessionId);
      } catch (error: unknown) {
        // Graceful degradation (spec §6.5): a profile-read failure must never
        // take the learner's lesson down with it. Logged, never silent.
        logger.warn({ err: error }, "adaptive context load failed — delegating to base provider");
        context = null;
      }
      if (context === null) {
        yield* base.turn(ctx);
        return;
      }

      const gaps = detectGaps(context.assessments);
      const previousStrategyId = lastStrategyId(ctx.history);
      const selection: StrategySelection = selectStrategy({
        profile: context.profile,
        gaps,
        previousStrategyId,
        askedForDifferent,
      });

      // Engine-made change only: the learner's own asks (explicit preference,
      // explain-differently) need no note written on their record.
      if (selection.changed && !selection.learnerInitiated) {
        try {
          await port.recordStrategyChange(ctx.sessionId, composeStrategyChange(selection));
        } catch (error: unknown) {
          logger.warn({ err: error }, "adaptive strategy-change note failed to record — turn continues");
        }
      }

      // Guarded above: askedForDifferent || stuck ⇒ gradingStep is defined.
      if (gradingStep === undefined) {
        yield* base.turn(ctx);
        return;
      }
      const strategy = STRATEGIES[selection.strategyId];
      const built = strategy.buildTurn(ctx);
      yield { type: "text", kind: "reteach", stepId: gradingStep.id, delta: built.delta, strategyId: strategy.id };
      yield { type: "done", spoken: built.spoken };
    },
  };
}
