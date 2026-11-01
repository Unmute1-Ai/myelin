// Selector rules under fixed evidence (spec §6.4): deterministic selection,
// explicit-preference-first (deliberate nulls honored), no unprompted repeat
// of the immediately-preceding strategy, explain-differently always available.

import { describe, expect, it } from "vitest";
import type { LearningGap } from "../../assessment/exercises";
import { DEFAULT_STRATEGY, selectStrategy } from "./selector";

function gap(kind: LearningGap["kind"], strength = 0.8, subject = "math.money"): LearningGap {
  return { subject, skill: null, reason: `${kind} evidence`, strength, kind };
}

const plateau = () => gap("recall_plateau");
const stall = () => gap("comprehension_stall", 0.5);

function select(overrides: Partial<Parameters<typeof selectStrategy>[0]> = {}) {
  return selectStrategy({
    profile: { preferredStrategy: null, pacing: "standard", subjects: [] },
    gaps: [],
    previousStrategyId: null,
    askedForDifferent: false,
    ...overrides,
  });
}

describe("selectStrategy — determinism", () => {
  it("picks the same strategy for the same fixed evidence, every time", () => {
    const input = {
      profile: { preferredStrategy: null, pacing: "standard", subjects: [] },
      gaps: [plateau()],
      previousStrategyId: null,
      askedForDifferent: false,
    };
    const runs = Array.from({ length: 10 }, () => selectStrategy(input).strategyId);
    expect(new Set(runs).size).toBe(1);
  });

  it("evidence no strategy weighs leaves all fits at 0 — the default wins", () => {
    expect(select({ gaps: [gap("stale_evidence", 0.0)] }).strategyId).toBe(DEFAULT_STRATEGY);
  });
});

describe("selectStrategy — explicit preference first", () => {
  it("the student's standing pick wins even against strong contrary evidence", () => {
    // Plateau evidence pulls visual hardest; the pick says socratic.
    const selection = select({ profile: { preferredStrategy: "socratic", pacing: "standard", subjects: [] }, gaps: [plateau()] });
    expect(selection.strategyId).toBe("socratic");
    expect(selection.learnerInitiated).toBe(true);
  });

  it("an explicit pick may repeat the immediately-preceding strategy — the student asked for it", () => {
    const selection = select({
      profile: { preferredStrategy: "visual", pacing: "standard", subjects: [] },
      gaps: [plateau()],
      previousStrategyId: "visual",
    });
    expect(selection.strategyId).toBe("visual");
    expect(selection.changed).toBe(false);
  });

  it("a deliberate null never resurrects a pick and falls through to evidence fit", () => {
    const selection = select({ profile: { preferredStrategy: null, pacing: "standard", subjects: [] }, gaps: [plateau()] });
    expect(selection.strategyId).not.toBe(DEFAULT_STRATEGY); // evidence discriminated
    expect(selection.strategyId).toBe("visual"); // plateau's best fit
    expect(selection.learnerInitiated).toBe(false);
  });

  it("an unknown (open-vocabulary) pick is ignored, not thrown on", () => {
    const selection = select({ profile: { preferredStrategy: "telepathy", pacing: "standard", subjects: [] }, gaps: [plateau()] });
    expect(selection.learnerInitiated).toBe(false);
    expect(selection.strategyId).toBe("visual");
  });
});

describe("selectStrategy — evidence-weighted fit", () => {
  it("a recall plateau (memorized-but-not-understood) pulls visual hardest", () => {
    expect(select({ gaps: [plateau()] }).strategyId).toBe("visual");
  });

  it("a comprehension stall pulls practice hardest", () => {
    expect(select({ gaps: [stall()] }).strategyId).toBe("practice");
  });

  it("the chosen strategy reports the gap that drove it", () => {
    const gapRow = plateau();
    const selection = select({ gaps: [gapRow] });
    expect(selection.drivingGap).toBe(gapRow);
  });

  it("with no evidence nothing discriminates — the default strategy wins", () => {
    const selection = select({});
    expect(selection.strategyId).toBe("step_by_step");
    expect(selection.changed).toBe(false); // first pick is not a change
    expect(selection.drivingGap).toBeNull();
  });
});

describe("selectStrategy — no unprompted repeat", () => {
  it("never repeats the immediately-preceding strategy when evidence would pick it", () => {
    // visual fits the plateau best — but visual was just used.
    const selection = select({ gaps: [plateau()], previousStrategyId: "visual" });
    expect(selection.strategyId).not.toBe("visual");
    expect(selection.changed).toBe(true);
    expect(selection.learnerInitiated).toBe(false);
  });

  it("the no-repeat exclusion yields the next-best evidence fit", () => {
    // Plateau order: visual, then example_based.
    const selection = select({ gaps: [plateau()], previousStrategyId: "visual" });
    expect(selection.strategyId).toBe("example_based");
  });

  it("the default step_by_step also yields when it was the previous strategy", () => {
    const selection = select({ gaps: [], previousStrategyId: "step_by_step" });
    expect(selection.strategyId).not.toBe("step_by_step");
    expect(selection.changed).toBe(true);
  });
});

describe("selectStrategy — the explain-differently override", () => {
  it("is always available and never repeats what the learner just saw", () => {
    const selection = select({
      profile: { preferredStrategy: "visual", pacing: "standard", subjects: [] },
      gaps: [plateau()], // visual fits best — but the learner is asking to move off it
      previousStrategyId: "visual",
      askedForDifferent: true,
    });
    expect(selection.strategyId).not.toBe("visual");
    expect(selection.learnerInitiated).toBe(true);
  });

  it("works even with no evidence at all", () => {
    const selection = select({ previousStrategyId: "step_by_step", askedForDifferent: true });
    expect(selection.strategyId).not.toBe("step_by_step");
    expect(selection.learnerInitiated).toBe(true);
  });
});
