// Every strategy module conforms to the one TeachingStrategy interface
// (spec §6.4): fixed id, 0..1 evidence-weighted fit, deterministic turns that
// re-present the stuck step and always keep the check question.

import { describe, expect, it } from "vitest";
import type { LearningGap } from "../../assessment/exercises";
import { DEMO_LESSON } from "../lesson/money-math";
import { buildSessionContext } from "../session-context";
import { ALL_STRATEGIES, STRATEGIES, STRATEGY_IDS, gradingStepOf } from "./strategies";

function gap(kind: LearningGap["kind"], strength = 0.8): LearningGap {
  return { subject: "math.money", skill: null, reason: `${kind} evidence`, strength, kind };
}

/** Context standing on step "pennies": taught, not yet answered. */
function stuckContext(input = "i don't know") {
  const history = [{ role: "tutor" as const, content: "teaching", stepId: "pennies", kind: "teach" as const }];
  return buildSessionContext(history, DEMO_LESSON, input);
}

const FIT_INPUT = (gaps: readonly LearningGap[]) => ({
  profile: { preferredStrategy: null, pacing: "standard", subjects: ["math.money"] },
  gaps,
});

describe("TeachingStrategy interface conformance", () => {
  it("exposes exactly the six spec'd strategies behind the one interface", () => {
    expect(ALL_STRATEGIES.length).toBe(6);
    expect(ALL_STRATEGIES.map((s) => s.id)).toEqual([...STRATEGY_IDS]);
    expect(Object.keys(STRATEGIES)).toEqual([...STRATEGY_IDS]);
  });

  it("every module's fit is a number in 0..1, clamped under stacked evidence", () => {
    for (const strategy of ALL_STRATEGIES) {
      const clamped = strategy.fits(FIT_INPUT([gap("recall_plateau", 0.8), gap("comprehension_stall", 0.5), gap("stale_evidence", 0.9)]));
      expect(clamped).toBeGreaterThanOrEqual(0);
      expect(clamped).toBeLessThanOrEqual(1);
    }
  });

  it("fit responds to gap shape: a plateau pulls visual harder than socratic", () => {
    const gaps = [gap("recall_plateau")];
    expect(STRATEGIES.visual.fits(FIT_INPUT(gaps))).toBeGreaterThan(STRATEGIES.socratic.fits(FIT_INPUT(gaps)));
  });

  it("with no gaps no strategy claims evidence fit (the selector's default rule owns that case)", () => {
    for (const strategy of ALL_STRATEGIES) {
      expect(strategy.fits(FIT_INPUT([]))).toBe(0);
    }
  });
});

describe("strategy turns", () => {
  it("are deterministic: same context, same words", () => {
    const ctx = stuckContext();
    for (const strategy of ALL_STRATEGIES) {
      const first = strategy.buildTurn(ctx);
      const second = strategy.buildTurn(ctx);
      expect(first.delta).toBe(second.delta);
      expect(first.spoken).toBe(second.spoken);
    }
  });

  it("always keep the step's check question — the learner is never left without the ask", () => {
    const ctx = stuckContext();
    const question = DEMO_LESSON.steps[0]!.check.question;
    for (const strategy of ALL_STRATEGIES) {
      expect(strategy.buildTurn(ctx).delta).toContain(question);
    }
  });

  it("re-present the step: no strategy echoes the scripted original shape verbatim", () => {
    const ctx = stuckContext();
    const step = gradingStepOf(ctx);
    const original = `${step.teaching}\n\n${step.check.question}`;
    for (const strategy of ALL_STRATEGIES) {
      expect(strategy.buildTurn(ctx).delta).not.toBe(original);
    }
  });

  it("each strategy sounds like itself", () => {
    const ctx = stuckContext();
    expect(STRATEGIES.visual.buildTurn(ctx).delta).toContain("see");
    expect(STRATEGIES.step_by_step.buildTurn(ctx).delta).toMatch(/1\./); // numbered micro-steps
    expect(STRATEGIES.socratic.buildTurn(ctx).delta).toContain("notice");
    expect(STRATEGIES.example_based.buildTurn(ctx).delta).toContain("worked all the way through");
    expect(STRATEGIES.practice.buildTurn(ctx).delta).toContain("together");
    expect(STRATEGIES.adaptive_challenge.buildTurn(ctx).delta).toContain("stretch");
  });

  it("carry a short spoken version, never the full detail", () => {
    const ctx = stuckContext();
    for (const strategy of ALL_STRATEGIES) {
      const turn = strategy.buildTurn(ctx);
      expect(turn.spoken.length).toBeGreaterThan(0);
      expect(turn.spoken.length).toBeLessThan(turn.delta.length);
    }
  });
});

describe("gradingStepOf", () => {
  it("resolves the live grading step the strategies re-present", () => {
    expect(gradingStepOf(stuckContext()).id).toBe("pennies");
  });

  it("fails loud when the engine's guard is bypassed — never a silent wrong turn", () => {
    const noStep = buildSessionContext([], DEMO_LESSON, "hello");
    expect(() => gradingStepOf(noStep)).toThrow();
  });
});
