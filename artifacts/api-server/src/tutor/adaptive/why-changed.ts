// Learner-readable why_changed notes for engine-made strategy changes
// (spec §6.2: the learner gets to know why the teaching changed). Pure
// composition — the engine owns the write through the profile service seam.

import type { StrategySelection } from "./selector";
import { STRATEGY_LABELS } from "./strategies";

/** The payload the engine hands to AdaptiveContextPort.recordStrategyChange. */
export interface StrategyChangeRecord {
  detail: string;
  whyChanged: string;
  subject?: string;
}

/**
 * Compose the transparency record for one engine-made strategy change. The
 * note cites the gap's own evidence reason when evidence drove the pick, so
 * the learner's record never says "the engine felt like it".
 */
export function composeStrategyChange(selection: StrategySelection): StrategyChangeRecord {
  const label = STRATEGY_LABELS[selection.strategyId];
  const gap = selection.drivingGap;
  return {
    detail: `Teaching approach changed to ${label}.`,
    whyChanged:
      gap !== null
        ? `Switching to ${label} this time. ${gap.reason}`
        : `Switching to ${label} this time — the same approach twice in a row rarely helps.`,
    ...(gap !== null ? { subject: gap.subject } : {}),
  };
}
