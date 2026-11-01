// Gap detection and targeted exercise selection (spec §6.3: "Exercises target
// detected gaps"). Gaps derive from assessment evidence only, and the selector
// aims exercises at those gaps — strongest first, no repeats, no forcing.
import { describe, expect, it } from "vitest";
import { AssessmentEvidenceKind, MasteryLevel } from "@workspace/api-zod";
import type { Assessment } from "@workspace/db/schema";
import { detectGaps, selectExercises, type TargetedExercise } from "./exercises";

const NOW = new Date("2026-11-01T12:00:00.000Z");
const STUDENT_ID = "00000000-0000-4000-8000-000000000001";

function row(overrides: Partial<Assessment> & { daysAgo?: number }): Assessment {
  const { daysAgo = 1, ...rest } = overrides;
  return {
    id: "00000000-0000-4000-8000-0000000000ff",
    studentId: STUDENT_ID,
    sessionId: null,
    turnId: null,
    subject: "math.money",
    skill: "making_change",
    level: MasteryLevel.recognition,
    evidenceKind: AssessmentEvidenceKind.recall,
    evidenceNote: "test evidence",
    createdAt: new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000),
    ...rest,
  } as Assessment;
}

const recallPlateau: Assessment[] = [
  row({ id: "a1", daysAgo: 5, level: MasteryLevel.memorization }),
  row({ id: "a2", daysAgo: 3, level: MasteryLevel.recognition }),
  row({ id: "a3", daysAgo: 1, level: MasteryLevel.recognition }),
];

describe("detecting gaps from assessment evidence", () => {
  it("flags a recall plateau — correct answers on practiced problems, no independent application", () => {
    const gaps = detectGaps(recallPlateau, { now: NOW });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.subject).toBe("math.money");
    expect(gaps[0]?.skill).toBe("making_change");
    expect(gaps[0]?.reason).toMatch(/no independent application/i);
  });

  it("does not flag a skill that already shows independent application", () => {
    const gaps = detectGaps(
      [
        ...recallPlateau,
        row({
          id: "a4",
          daysAgo: 1,
          level: MasteryLevel.comprehension,
          evidenceKind: AssessmentEvidenceKind.application,
          evidenceNote: "solved a novel problem unaided",
        }),
      ],
      { now: NOW },
    );
    expect(gaps).toEqual([]);
  });

  it("flags a comprehension stall — independent but never consistent", () => {
    const gaps = detectGaps(
      [
        row({
          id: "a1",
          daysAgo: 4,
          level: MasteryLevel.comprehension,
          evidenceKind: AssessmentEvidenceKind.application,
        }),
        row({
          id: "a2",
          daysAgo: 1,
          level: MasteryLevel.comprehension,
          evidenceKind: AssessmentEvidenceKind.explanation,
        }),
      ],
      { now: NOW },
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.reason).toMatch(/not yet consistent/i);
  });

  it("flags stale evidence for a fresh check", () => {
    const gaps = detectGaps(
      [
        row({ id: "a1", daysAgo: 40, level: MasteryLevel.application }),
        row({ id: "a2", daysAgo: 35, level: MasteryLevel.comprehension }),
      ],
      { now: NOW },
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.reason).toMatch(/30 days/i);
  });

  it("keeps different skills and subjects separate", () => {
    const gaps = detectGaps(
      [
        ...recallPlateau,
        row({
          id: "b1",
          subject: "math.fractions",
          skill: null,
          daysAgo: 40,
          level: MasteryLevel.mastery,
          evidenceKind: AssessmentEvidenceKind.transfer,
        }),
      ],
      { now: NOW },
    );
    expect(gaps).toHaveLength(2);
    expect(gaps.map((g) => g.subject)).toEqual(["math.money", "math.fractions"]);
  });
});

describe("selecting exercises that target detected gaps", () => {
  const bank: TargetedExercise[] = [
    { id: "ex-novel-change", subject: "math.money", skill: "making_change" },
    { id: "ex-counting", subject: "math.money", skill: "counting_coins" },
    { id: "ex-money-general", subject: "math.money", skill: null },
    { id: "ex-geometry", subject: "math.geometry", skill: "areas" },
  ];

  it("aims the strongest gap's skill first and skips non-matching exercises", () => {
    const gaps = detectGaps(recallPlateau, { now: NOW });
    const chosen = selectExercises(gaps, bank);
    expect(chosen.map((e) => e.id)).toEqual(["ex-novel-change"]);
  });

  it("serves a subject-level gap with any exercise in that subject", () => {
    const gaps = detectGaps(
      [
        row({ skill: null, daysAgo: 1, level: MasteryLevel.memorization }),
        row({ skill: null, daysAgo: 2, level: MasteryLevel.recognition }),
        row({ skill: null, daysAgo: 3, level: MasteryLevel.memorization }),
      ],
      { now: NOW },
    );
    // No skill pinned — any math.money exercise can target the gap.
    const chosen = selectExercises(gaps, bank);
    expect(chosen.map((e) => e.id)).toEqual(["ex-novel-change", "ex-counting", "ex-money-general"]);
  });

  it("never repeats the exercise the learner just attempted", () => {
    const gaps = detectGaps(recallPlateau, { now: NOW });
    const chosen = selectExercises(gaps, bank, { previousExerciseId: "ex-novel-change" });
    expect(chosen).toEqual([]);
  });

  it("never forces an exercise when the bank has nothing that matches", () => {
    const gaps = detectGaps(recallPlateau, { now: NOW });
    const chosen = selectExercises(gaps, [
      { id: "ex-geometry", subject: "math.geometry", skill: "areas" },
    ]);
    expect(chosen).toEqual([]);
  });

  it("orders multiple gaps by strength and respects the limit", () => {
    const gaps = detectGaps(
      [
        ...recallPlateau, // strength 0.8 — math.money · making_change
        row({
          id: "b1",
          subject: "math.geometry",
          skill: "angles",
          daysAgo: 40,
          level: MasteryLevel.comprehension,
          evidenceKind: AssessmentEvidenceKind.application,
        }),
        row({
          id: "b2",
          subject: "math.geometry",
          skill: "angles",
          daysAgo: 35,
          level: MasteryLevel.comprehension,
          evidenceKind: AssessmentEvidenceKind.application,
        }),
      ], // strength 0.5 — math.geometry · angles
      { now: NOW },
    );
    const chosen = selectExercises(
      gaps,
      [
        { id: "ex-angles-1", subject: "math.geometry", skill: "angles" },
        { id: "ex-angles-2", subject: "math.geometry", skill: "angles" },
        { id: "ex-change-1", subject: "math.money", skill: "making_change" },
        { id: "ex-change-2", subject: "math.money", skill: "making_change" },
      ],
      { limit: 3 },
    );
    // The recall plateau (0.8) outranks the comprehension stall (0.5).
    expect(chosen.map((e) => e.id)).toEqual(["ex-change-1", "ex-change-2", "ex-angles-1"]);
  });
});
