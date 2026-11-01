// Unit tests for the shared session-context derivation — the one place
// lesson position is computed from history markers.

import { describe, expect, it } from "vitest";
import { DEMO_LESSON } from "./lesson/money-math";
import { buildSessionContext, derivePosition, reteachCount } from "./session-context";
import { MASTERED_MARKER, type TurnMessage } from "./types";

const LESSON = DEMO_LESSON;

function teach(stepId: string): TurnMessage {
  return { role: "tutor", content: "teaching", stepId, kind: "teach" };
}

function advance(stepId: string): TurnMessage {
  return { role: "tutor", content: "moved on", stepId, kind: "advance" };
}

describe("derivePosition", () => {
  it("an empty history teaches from the top", () => {
    const position = derivePosition([], LESSON);
    expect(position.taughtIds).toEqual([]);
    expect(position.advancedIds).toEqual([]);
    expect(position.gradingStepId).toBeNull();
    expect(position.nextTeachId).toBe(LESSON.steps[0]?.id ?? null);
    expect(position.mastered).toBe(false);
  });

  it("taught-but-not-advanced is the step being graded", () => {
    const [first, second] = LESSON.steps;
    const position = derivePosition([teach(first!.id!), teach(second!.id!)], LESSON);
    expect(position.taughtIds).toEqual([first!.id, second!.id]);
    expect(position.gradingStepId).toBe(second!.id);
    expect(position.nextTeachId).toBe(LESSON.steps[2]?.id ?? null);
  });

  it("confirmed advances move the grading step forward", () => {
    const [first, second] = LESSON.steps;
    const position = derivePosition([teach(first!.id!), advance(first!.id!), teach(second!.id!)], LESSON);
    expect(position.advancedIds).toEqual([first!.id]);
    expect(position.gradingStepId).toBe(second!.id);
  });

  it("all steps advanced leaves nothing to grade and nothing to teach", () => {
    const history = LESSON.steps.flatMap((s) => [teach(s.id), advance(s.id)]);
    const position = derivePosition(history, LESSON);
    expect(position.gradingStepId).toBeNull();
    expect(position.nextTeachId).toBeNull();
    expect(position.mastered).toBe(false);
  });

  it("the mastered marker is recognized and distinct from step advances", () => {
    const history = [...LESSON.steps.flatMap((s) => [teach(s.id), advance(s.id)]), advance(MASTERED_MARKER)];
    const position = derivePosition(history, LESSON);
    expect(position.mastered).toBe(true);
    expect(position.advancedIds).toEqual([...LESSON.steps.map((s) => s.id), MASTERED_MARKER]);
  });
});

describe("reteachCount", () => {
  it("counts only tutor reteach markers for the given step", () => {
    const [first] = LESSON.steps;
    const history: TurnMessage[] = [
      teach(first!.id!),
      { role: "tutor", content: "again", stepId: first!.id, kind: "reteach" },
      { role: "tutor", content: "again", stepId: first!.id, kind: "reteach" },
      { role: "learner", content: "again", stepId: first!.id, kind: "reteach" }, // learner role never counts
      { role: "tutor", content: "again", stepId: "other", kind: "reteach" }, // other step never counts
    ];
    expect(reteachCount(history, first!.id)).toBe(2);
  });
});

describe("buildSessionContext", () => {
  it("carries history, lesson, and input unchanged", () => {
    const history = [teach(LESSON.steps[0]!.id!)];
    const ctx = buildSessionContext(history, LESSON, "i don't know");
    expect(ctx.history).toBe(history);
    expect(ctx.lesson).toBe(LESSON);
    expect(ctx.input).toBe("i don't know");
    expect(ctx.position.gradingStepId).toBe(LESSON.steps[0]?.id ?? null);
  });
});
