// The evidence rules for the learning record (spec §6.2), as pure schema
// tests — no database, they run everywhere. The no-fabrication rule lives
// here: a gap or misconception with nothing behind it is rejected before any
// route or service can write it, and a strategy change that cannot explain
// itself in learner-readable words is rejected too.

import { describe, expect, it } from "vitest";
import { CreateProfileEntryInput } from "./entry-rules";

const ASSESSMENT_ID = "00000000-0000-4000-8000-000000000001";
const TURN_ID = "00000000-0000-4000-8000-000000000002";

function parse(body: unknown) {
  return CreateProfileEntryInput.safeParse(body);
}

describe("evidence-only gaps and misconceptions (no fabrication path)", () => {
  it("rejects a gap with no evidence reference", () => {
    const result = parse({ kind: "gap", detail: "Struggles with regrouping." });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("evidence");
    }
  });

  it("rejects a misconception with no evidence reference", () => {
    const result = parse({
      kind: "misconception",
      detail: "Thinks multiplication repeats addition.",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a gap citing an owned assessment", () => {
    const result = parse({
      kind: "gap",
      subject: "math",
      detail: "Regrouping across zeros stalls.",
      sourceAssessmentId: ASSESSMENT_ID,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a misconception citing a session turn", () => {
    const result = parse({
      kind: "misconception",
      detail: "Carried the wrong digit.",
      sourceTurnId: TURN_ID,
    });
    expect(result.success).toBe(true);
  });

  it("still rejects an evidence reference that is not a uuid", () => {
    const result = parse({
      kind: "gap",
      detail: "...",
      sourceAssessmentId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("accepts preferences and successful approaches without evidence — they are self-declared", () => {
    expect(
      parse({ kind: "preference", detail: "Pictures before words." }).success,
    ).toBe(true);
    expect(
      parse({ kind: "successful_approach", detail: "Number line worked." })
        .success,
    ).toBe(true);
  });

  it("requires a non-empty detail", () => {
    expect(parse({ kind: "preference", detail: "" }).success).toBe(false);
  });
});

describe("strategy transparency (whyChanged on every strategy change)", () => {
  it("rejects a strategy change with no whyChanged note", () => {
    const result = parse({
      kind: "strategy_change",
      detail: "Switching to visual.",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a blank whyChanged note", () => {
    const result = parse({
      kind: "strategy_change",
      detail: "Switching to visual.",
      whyChanged: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a strategy change whose note explains itself to the learner", () => {
    const result = parse({
      kind: "strategy_change",
      detail: "Trying pictures for fractions.",
      whyChanged:
        "The last two step-by-step tries stalled, so let's draw it instead.",
      subject: "math",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.whyChanged).toContain("draw it");
      expect(result.data.kind).toBe("strategy_change");
    }
  });
});
