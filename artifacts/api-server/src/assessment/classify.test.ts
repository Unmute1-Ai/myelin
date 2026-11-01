// The mastery-evidence rule (spec §6.3) — the assessment engine's centerpiece.
// A correct answer alone never awards above recognition; comprehension and
// above require independent application evidence (novel problem, transfer, or
// unprompted explanation); every classification carries its human-readable
// evidence.
import { describe, expect, it } from "vitest";
import { AssessmentEvidenceKind, MasteryLevel } from "@workspace/api-zod";
import { classifyMastery, masteryObservationSchema } from "./classify";

const RECALL_ONLY_LEVELS = [MasteryLevel.memorization, MasteryLevel.recognition] as const;
const INDEPENDENT_LEVELS = [
  MasteryLevel.comprehension,
  MasteryLevel.application,
  MasteryLevel.mastery,
] as const;

/** The (evidenceKind, level) pairs the DB CHECK on `assessments` permits. */
function isLegalPair(kind: string, level: string): boolean {
  if (kind === AssessmentEvidenceKind.recall) {
    return (RECALL_ONLY_LEVELS as readonly string[]).includes(level);
  }
  return (INDEPENDENT_LEVELS as readonly string[]).includes(level);
}

describe("the binding rule: a correct answer alone never awards above recognition", () => {
  it("caps a produced answer at memorization", () => {
    const result = classifyMastery({
      kind: "recall",
      correct: true,
      mode: "produced",
    });
    expect(result).not.toBeNull();
    expect(result?.level).toBe(MasteryLevel.memorization);
    expect(result?.evidenceKind).toBe(AssessmentEvidenceKind.recall);
  });

  it("caps a recognized answer at recognition", () => {
    const result = classifyMastery({
      kind: "recall",
      correct: true,
      mode: "recognized",
    });
    expect(result?.level).toBe(MasteryLevel.recognition);
    expect(result?.evidenceKind).toBe(AssessmentEvidenceKind.recall);
  });

  it("never lets recall evidence classify into comprehension, application, or mastery", () => {
    for (const mode of ["produced", "recognized"] as const) {
      for (const forbidden of INDEPENDENT_LEVELS) {
        const result = classifyMastery({ kind: "recall", correct: true, mode });
        expect(result?.level, `mode=${mode} vs ${forbidden}`).not.toBe(forbidden);
      }
    }
  });
});

describe("independent application evidence (spec §6.3)", () => {
  it("awards comprehension for a novel problem solved unaided", () => {
    const result = classifyMastery({
      kind: "application",
      correct: true,
      novel: true,
      scaffolded: false,
    });
    expect(result?.level).toBe(MasteryLevel.comprehension);
    expect(result?.evidenceKind).toBe(AssessmentEvidenceKind.application);
  });

  it("awards the application level when independent application repeats", () => {
    const result = classifyMastery(
      { kind: "application", correct: true, novel: true, scaffolded: false },
      { priorIndependentSuccesses: 1 },
    );
    expect(result?.level).toBe(MasteryLevel.application);
    expect(result?.evidenceKind).toBe(AssessmentEvidenceKind.application);
  });

  it("treats scaffolded success as encouraging but not independent — no mastery row", () => {
    const result = classifyMastery({
      kind: "application",
      correct: true,
      novel: true,
      scaffolded: true,
    });
    expect(result).toBeNull();
  });

  it("awards comprehension for an unprompted explanation", () => {
    const result = classifyMastery({
      kind: "explanation",
      correct: true,
      unprompted: true,
    });
    expect(result?.level).toBe(MasteryLevel.comprehension);
    expect(result?.evidenceKind).toBe(AssessmentEvidenceKind.explanation);
  });

  it("does not count a prompted explanation as independent evidence", () => {
    const result = classifyMastery({
      kind: "explanation",
      correct: true,
      unprompted: false,
    });
    expect(result).toBeNull();
  });

  it("awards mastery only for transfer to a new context", () => {
    const result = classifyMastery({ kind: "transfer", correct: true });
    expect(result?.level).toBe(MasteryLevel.mastery);
    expect(result?.evidenceKind).toBe(AssessmentEvidenceKind.transfer);
  });

  it("reaches every level in the spec's enum through honest evidence", () => {
    const ladder = [
      classifyMastery({ kind: "recall", correct: true, mode: "produced" }),
      classifyMastery({ kind: "recall", correct: true, mode: "recognized" }),
      classifyMastery({ kind: "application", correct: true, novel: true, scaffolded: false }),
      classifyMastery(
        { kind: "application", correct: true, novel: true, scaffolded: false },
        { priorIndependentSuccesses: 1 },
      ),
      classifyMastery({ kind: "transfer", correct: true }),
    ].map((result) => result?.level);
    expect(ladder).toEqual([
      MasteryLevel.memorization,
      MasteryLevel.recognition,
      MasteryLevel.comprehension,
      MasteryLevel.application,
      MasteryLevel.mastery,
    ]);
  });
});

describe("observations that are not mastery evidence", () => {
  it("never records an incorrect answer as a mastery row", () => {
    const incorrect = [
      { kind: "recall", correct: false, mode: "produced" },
      { kind: "recall", correct: false, mode: "recognized" },
      { kind: "application", correct: false, novel: true, scaffolded: false },
      { kind: "explanation", correct: false, unprompted: true },
      { kind: "transfer", correct: false },
    ] as const;
    for (const observation of incorrect) {
      expect(classifyMastery(observation), JSON.stringify(observation)).toBeNull();
    }
  });

  it("rejects unknown observation kinds at the runtime boundary", () => {
    expect(() =>
      masteryObservationSchema.parse({ kind: "vibes", correct: true }),
    ).toThrow();
  });
});

describe("classification integrity", () => {
  const observations = [
    { kind: "recall", correct: true, mode: "produced" },
    { kind: "recall", correct: true, mode: "recognized" },
    { kind: "application", correct: true, novel: true, scaffolded: false },
    { kind: "application", correct: true, novel: false, scaffolded: false },
    { kind: "explanation", correct: true, unprompted: true },
    { kind: "transfer", correct: true },
  ] as const;

  it("only ever emits evidence/level pairings the mastery rule permits", () => {
    for (const observation of observations) {
      for (const prior of [0, 1, 5]) {
        const result = classifyMastery(observation, { priorIndependentSuccesses: prior });
        if (result === null) continue;
        expect(
          isLegalPair(result.evidenceKind, result.level),
          `${JSON.stringify(observation)} prior=${prior} → ${result.evidenceKind}/${result.level}`,
        ).toBe(true);
      }
    }
  });

  it("carries a human-readable evidenceNote naming the observed behavior", () => {
    for (const observation of observations) {
      const result = classifyMastery(observation);
      expect(result?.evidenceNote ?? "").not.toBe("");
    }
  });
});
