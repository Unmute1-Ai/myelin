// Teaching strategies (spec §6.4). Six modules behind one interface: each
// declares how well it fits a learner's evidence-derived gaps (0..1, pure)
// and builds a re-presentation of the stuck step in its own style.
//
// Strategies are frames around the lesson's own content — they never invent
// facts the lesson doesn't carry, never move the lesson position, and always
// end with the step's check question so the learner is never left without
// the ask. Pure functions only: no store, no clock.

import type { LearningGap } from "../../assessment/exercises";
import type { LessonStep } from "../lesson/types";
import type { SessionContext } from "../session-context";

export const STRATEGY_IDS = [
  "visual",
  "step_by_step",
  "socratic",
  "example_based",
  "practice",
  "adaptive_challenge",
] as const;

export type StrategyId = (typeof STRATEGY_IDS)[number];

/** The learner-facing name of each strategy, for why_changed notes and UI. */
export const STRATEGY_LABELS: Record<StrategyId, string> = {
  visual: "pictures",
  step_by_step: "small steps",
  socratic: "questions to think with",
  example_based: "a worked example",
  practice: "practice together",
  adaptive_challenge: "a bigger challenge",
};

/**
 * The profile shape strategies are allowed to see: the student's explicit
 * choices only. A deliberate `null` preferredStrategy means "no standing
 * pick" — the selector falls through to evidence fit, never resurrects.
 */
export interface StrategyProfile {
  readonly preferredStrategy: string | null;
  readonly pacing: string;
  readonly subjects: readonly string[];
}

export interface StrategyFitInput {
  readonly profile: StrategyProfile;
  /** Gaps detected from the student's own assessment rows (spec §6.3) — nothing else. */
  readonly gaps: readonly LearningGap[];
}

/** A strategy's built turn: full detail on screen, short spoken version. */
export interface StrategyTurn {
  readonly delta: string;
  readonly spoken: string;
}

/**
 * One adaptive teaching strategy (spec §6.4). `fits` weighs evidence;
 * `buildTurn` re-presents the step the learner is currently stuck on — the
 * engine guarantees a live grading step before calling it.
 */
export interface TeachingStrategy {
  readonly id: StrategyId;
  /** 0..1 evidence-weighted fit; deterministic for a fixed input. */
  fits(input: StrategyFitInput): number;
  buildTurn(ctx: SessionContext): StrategyTurn;
}

/** The step a strategy re-presents — the last one taught and not yet advanced past. */
export function gradingStepOf(ctx: SessionContext): LessonStep {
  const step = ctx.lesson.steps.find((s) => s.id === ctx.position.gradingStepId);
  if (step === undefined) {
    throw new Error("a strategy turn requires a live grading step — the engine guards this");
  }
  return step;
}

/**
 * How strongly each gap shape pulls each strategy. Weights are a strategy's
 * declared expertise, applied as strength × weight per gap; the selector
 * treats a total fit of 0 as "nothing discriminates" and uses its default.
 */
const GAP_WEIGHTS: Record<StrategyId, Partial<Record<LearningGap["kind"], number>>> = {
  // Memorized-but-not-understood: show the idea a different way, or work a
  // full example end to end.
  visual: { recall_plateau: 0.6, comprehension_stall: 0.2 },
  example_based: { recall_plateau: 0.45, comprehension_stall: 0.2 },
  step_by_step: { recall_plateau: 0.1, comprehension_stall: 0.1 },
  socratic: { recall_plateau: 0.05, comprehension_stall: 0.35 },
  practice: { recall_plateau: 0.1, comprehension_stall: 0.6, stale_evidence: 0.5 },
  adaptive_challenge: { recall_plateau: -0.3, comprehension_stall: 0.25, stale_evidence: 0.4 },
};

function sumGapFit(id: StrategyId, gaps: readonly LearningGap[]): number {
  const weights = GAP_WEIGHTS[id];
  let total = 0;
  for (const gap of gaps) {
    total += gap.strength * (weights[gap.kind] ?? 0);
  }
  return Math.min(1, Math.max(0, total));
}

/** Shared fit body: every strategy scores the same gaps, its own weights. */
function makeStrategy(id: StrategyId, buildTurn: (ctx: SessionContext) => StrategyTurn): TeachingStrategy {
  return {
    id,
    fits: ({ gaps }) => sumGapFit(id, gaps),
    buildTurn,
  };
}

/** Re-present the step's teaching inside a framing, always ending on the check. */
function framedTurn(framing: string, body: string, step: LessonStep, spoken: string): StrategyTurn {
  return { delta: `${framing}\n\n${body}\n\n${step.check.question}`, spoken };
}

/** Split prose into sentences — the micro-step material for step_by_step. */
function sentences(prose: string): string[] {
  return prose
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export const VISUAL_STRATEGY = makeStrategy("visual", (ctx) => {
  const step = gradingStepOf(ctx);
  return framedTurn(
    "Let's make this something you can see.",
    `Draw it out as we go — circles for the things being counted, labels for the amounts. ${step.teaching}`,
    step,
    "Let's make this something you can see.",
  );
});

export const STEP_BY_STEP_STRATEGY = makeStrategy("step_by_step", (ctx) => {
  const step = gradingStepOf(ctx);
  const pieces = sentences(step.teaching);
  const numbered = pieces.map((piece, i) => `${i + 1}. ${piece}`).join("\n");
  return framedTurn(
    "One small piece at a time — nothing else until each piece makes sense.",
    numbered,
    step,
    "One small piece at a time.",
  );
});

export const SOCRATIC_STRATEGY = makeStrategy("socratic", (ctx) => {
  const step = gradingStepOf(ctx);
  return {
    delta:
      "Let's think it through together — no answers handed over, just noticing.\n\n" +
      `${step.check.question}\n\nStart anywhere: what's the first thing you notice? Whatever you spot, I'll work with it.`,
    spoken: "Let's think it through together — what's the first thing you notice?",
  };
});

export const EXAMPLE_BASED_STRATEGY = makeStrategy("example_based", (ctx) => {
  const step = gradingStepOf(ctx);
  const example = step.altTeaching ?? step.teaching;
  return framedTurn(
    "Here's one worked all the way through — watch the whole thing, then we'll try yours.",
    example,
    step,
    "Here's one worked all the way through.",
  );
});

export const PRACTICE_STRATEGY = makeStrategy("practice", (ctx) => {
  const step = gradingStepOf(ctx);
  return {
    delta:
      "Let's try one together, no pressure.\n\n" +
      `${step.check.question}\n\n` +
      "Take your best shot — a guess is fine. I'll take whatever you've got and we'll build from there.",
    spoken: "Let's try one together, no pressure.",
  };
});

export const ADAPTIVE_CHALLENGE_STRATEGY = makeStrategy("adaptive_challenge", (ctx) => {
  const step = gradingStepOf(ctx);
  return framedTurn(
    "You've got the basics — let's stretch them.",
    `${step.teaching}\n\nAnd if that's too easy, say so — I'll make it harder.`,
    step,
    "Let's stretch it a little.",
  );
});

/** The six strategies, in fixed order — the deterministic tiebreak order. */
export const STRATEGIES: Record<StrategyId, TeachingStrategy> = {
  visual: VISUAL_STRATEGY,
  step_by_step: STEP_BY_STEP_STRATEGY,
  socratic: SOCRATIC_STRATEGY,
  example_based: EXAMPLE_BASED_STRATEGY,
  practice: PRACTICE_STRATEGY,
  adaptive_challenge: ADAPTIVE_CHALLENGE_STRATEGY,
};

export const ALL_STRATEGIES: readonly TeachingStrategy[] = STRATEGY_IDS.map((id) => STRATEGIES[id]);

export function isStrategyId(value: string): value is StrategyId {
  return (STRATEGY_IDS as readonly string[]).includes(value);
}
