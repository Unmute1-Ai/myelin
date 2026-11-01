// Strategy selection (spec §6.4). Pure and deterministic — same inputs, same
// pick, always.
//
// Selection order:
//   1. "Explain it differently" — the learner's always-available override.
//      It never repeats the strategy the learner just saw: they are asking
//      for a different way in.
//   2. Explicit student preference — a standing pick on the profile wins,
//     including over the no-repeat rule (a standing pick IS the student
//     asking for it). A deliberate `null` is honored as "no pick": selection
//     falls through to evidence, never back-fills a previous value.
//   3. Evidence-weighted fit — highest fits() among gaps derived from
//     assessment evidence only, excluding the immediately-preceding strategy
//     (no unprompted repeats). Ties break by fixed STRATEGY_IDS order.
//   4. Default — when no evidence discriminates (all fits are 0):
//     step_by_step, the lesson's native mode; if that would repeat, the next
//     strategy in fixed order.

import type { LearningGap } from "../../assessment/exercises";
import {
  STRATEGIES,
  STRATEGY_IDS,
  STRATEGY_LABELS,
  isStrategyId,
  type StrategyId,
  type StrategyProfile,
} from "./strategies";

export const DEFAULT_STRATEGY: StrategyId = "step_by_step";

export interface SelectStrategyInput {
  readonly profile: StrategyProfile;
  /** Gaps from the student's own assessment evidence only (spec §6.3). */
  readonly gaps: readonly LearningGap[];
  /**
   * Strategy of the immediately-preceding strategy-tagged tutor turn; null
   * when no strategy turn has happened yet (first pick is not a change).
   */
  readonly previousStrategyId: string | null;
  /** The learner asked to hear it differently — the override is always available. */
  readonly askedForDifferent: boolean;
}

export interface StrategySelection {
  readonly strategyId: StrategyId;
  /**
   * True when the learner authored this selection (explicit preference or an
   * explain-differently ask). The engine writes why_changed only for
   * engine-made changes — a learner-initiated switch needs no explanation
   * written on their record.
   */
  readonly learnerInitiated: boolean;
  /** True when this selection differs from the immediately-preceding strategy turn. */
  readonly changed: boolean;
  /** The gap that most moved the chosen strategy; null when not gap-driven. */
  readonly drivingGap: LearningGap | null;
}

/** Weighted contribution of `gap` to strategy `id` — the fit arithmetic, shared. */
function contribution(id: StrategyId, gap: LearningGap): number {
  return gap.strength * STRATEGIES[id].fits({ profile: { preferredStrategy: null, pacing: "", subjects: [] }, gaps: [gap] });
}

/** The gap that contributes most to `id`'s fit; null when no gap moves it. */
function drivingGapFor(id: StrategyId, gaps: readonly LearningGap[]): LearningGap | null {
  let best: LearningGap | null = null;
  let bestContribution = 0;
  for (const gap of gaps) {
    const c = contribution(id, gap);
    if (c > bestContribution) {
      bestContribution = c;
      best = gap;
    }
  }
  return best;
}

function selectByFit(
  profile: StrategyProfile,
  gaps: readonly LearningGap[],
  exclude: string | null,
): { strategyId: StrategyId; fit: number } {
  // No-repeat: the excluded strategy leaves the pool. With six strategies the
  // pool can't empty, but the guard keeps the rule total — a repeat is only
  // ever possible when there is genuinely nothing else.
  const pool = STRATEGY_IDS.filter((id) => id !== exclude);
  const candidates = pool.length > 0 ? pool : [...STRATEGY_IDS];

  let bestId: StrategyId = candidates[0];
  let bestFit = -1;
  for (const id of candidates) {
    const fit = STRATEGIES[id].fits({ profile, gaps });
    if (fit > bestFit) {
      bestId = id;
      bestFit = fit;
    }
  }
  return { strategyId: bestId, fit: bestFit };
}

export function selectStrategy(input: SelectStrategyInput): StrategySelection {
  const { profile, gaps, previousStrategyId, askedForDifferent } = input;

  // 1. The learner's always-available override — and it must land somewhere
  //    other than what they just saw, or it isn't "different".
  if (askedForDifferent) {
    const picked = selectByFit(profile, gaps, previousStrategyId);
    return {
      strategyId: picked.strategyId,
      learnerInitiated: true,
      changed: previousStrategyId !== null && picked.strategyId !== previousStrategyId,
      drivingGap: drivingGapFor(picked.strategyId, gaps),
    };
  }

  // 2. Explicit preference — only when it names a strategy module that
  //    exists. The column is open vocabulary so modules can grow without a
  //    migration; an unknown pick (or a deliberate null) falls through.
  const preferred = profile.preferredStrategy;
  if (preferred !== null && isStrategyId(preferred)) {
    return {
      strategyId: preferred,
      learnerInitiated: true,
      changed: previousStrategyId !== null && preferred !== previousStrategyId,
      drivingGap: drivingGapFor(preferred, gaps),
    };
  }

  // 3. Evidence-weighted fit, no unprompted repeat of the previous strategy.
  const picked = selectByFit(profile, gaps, previousStrategyId);
  if (picked.fit > 0) {
    return {
      strategyId: picked.strategyId,
      learnerInitiated: false,
      changed: previousStrategyId !== null,
      drivingGap: drivingGapFor(picked.strategyId, gaps),
    };
  }

  // 4. Default: nothing discriminates — step_by_step unless it would repeat.
  const fallback =
    DEFAULT_STRATEGY === previousStrategyId
      ? (STRATEGY_IDS.find((id) => id !== previousStrategyId) ?? DEFAULT_STRATEGY) // unreachable: six ids, one excluded
      : DEFAULT_STRATEGY;
  return {
    strategyId: fallback,
    learnerInitiated: false,
    changed: previousStrategyId !== null,
    drivingGap: null,
  };
}

/** The label a why_changed note uses for a strategy id (unknown ids degrade honestly). */
export function strategyLabel(id: string): string {
  return isStrategyId(id) ? STRATEGY_LABELS[id] : id;
}
