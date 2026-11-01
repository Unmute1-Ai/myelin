// Mastery classification for the assessment engine (spec §6.3).
//
// The binding rule: a correct answer is evidence of memorization/recognition
// ONLY — comprehension and above require independent application evidence
// (a novel problem solved unaided, an unprompted explanation, or transfer to
// a new context). The DB CHECK on `assessments` and `insertAssessmentSchema`
// are the second and third lines of defense; this classifier is the first:
// it never emits an illegal (evidenceKind, level) pair, by construction.
import { z } from "zod/v4";
import { AssessmentEvidenceKind, MasteryLevel } from "@workspace/api-zod";

/**
 * What a turn or exercise attempt actually showed. `recall` covers graded
 * answers to practiced problems (produced from memory vs recognized among
 * options); the other kinds are the directive's enumeration of independent
 * evidence: a novel problem, an unprompted explanation, or transfer.
 */
export const masteryObservationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("recall"),
    correct: z.boolean(),
    mode: z.enum(["produced", "recognized"]),
  }),
  z.object({
    kind: z.literal("application"),
    correct: z.boolean(),
    novel: z.boolean(),
    scaffolded: z.boolean(),
  }),
  z.object({
    kind: z.literal("explanation"),
    correct: z.boolean(),
    unprompted: z.boolean(),
  }),
  z.object({
    kind: z.literal("transfer"),
    correct: z.boolean(),
  }),
]);
export type MasteryObservation = z.infer<typeof masteryObservationSchema>;

/**
 * The evidence/level pairings the mastery rule permits — the same set the
 * DB CHECK enforces. Recall evidence caps at recognition; non-recall
 * evidence is what comprehension and above are made of.
 */
export type PairedEvidenceLevel =
  | {
      evidenceKind: typeof AssessmentEvidenceKind.recall;
      level: typeof MasteryLevel.memorization | typeof MasteryLevel.recognition;
    }
  | {
      evidenceKind:
        | typeof AssessmentEvidenceKind.application
        | typeof AssessmentEvidenceKind.explanation
        | typeof AssessmentEvidenceKind.transfer;
      level:
        | typeof MasteryLevel.comprehension
        | typeof MasteryLevel.application
        | typeof MasteryLevel.mastery;
    };

/** A classification plus the human-readable evidence behind it. */
export type MasteryClassification = PairedEvidenceLevel & { evidenceNote: string };

export interface ClassificationContext {
  /**
   * Prior independent-evidence assessments (application/explanation/transfer)
   * on the same subject+skill. One independent success shows comprehension;
   * repeating it shows the application level. See `independentSuccessCount`.
   */
  priorIndependentSuccesses?: number;
}

/** A wrong or unsupported attempt is gap evidence, never a mastery row. */
export const NO_MASTERY_EVIDENCE = null as MasteryClassification | null;

/**
 * Classify one observation of learner behavior into a mastery level, or null
 * when the observation is not positive mastery evidence. Illegal pairings are
 * unrepresentable: recall observations can only classify at or below
 * recognition, and only transfer reaches mastery.
 */
export function classifyMastery(
  observation: MasteryObservation,
  context: ClassificationContext = {},
): MasteryClassification | null {
  const prior = context.priorIndependentSuccesses ?? 0;
  switch (observation.kind) {
    case "recall": {
      if (!observation.correct) return NO_MASTERY_EVIDENCE;
      // The binding cap: a correct answer alone — produced or recognized —
      // never awards above recognition (spec §6.3).
      return observation.mode === "produced"
        ? {
            evidenceKind: AssessmentEvidenceKind.recall,
            level: MasteryLevel.memorization,
            evidenceNote: "Answered a practiced problem correctly from memory.",
          }
        : {
            evidenceKind: AssessmentEvidenceKind.recall,
            level: MasteryLevel.recognition,
            evidenceNote: "Identified the correct answer on a practiced problem.",
          };
    }
    case "application": {
      // Hints and scaffolds mean the application was not independent — and
      // independent application is what comprehension requires.
      if (!observation.correct || observation.scaffolded) return NO_MASTERY_EVIDENCE;
      return prior >= 1
        ? {
            evidenceKind: AssessmentEvidenceKind.application,
            level: MasteryLevel.application,
            evidenceNote:
              "Applied the method unaided again — consistent independent application.",
          }
        : {
            evidenceKind: AssessmentEvidenceKind.application,
            level: MasteryLevel.comprehension,
            evidenceNote: "Solved a problem unaided by applying the method.",
          };
    }
    case "explanation": {
      // The directive names the *unprompted* explanation as independent
      // evidence; an explanation extracted question-by-question is not.
      if (!observation.correct || !observation.unprompted) return NO_MASTERY_EVIDENCE;
      return prior >= 1
        ? {
            evidenceKind: AssessmentEvidenceKind.explanation,
            level: MasteryLevel.application,
            evidenceNote:
              "Explained their reasoning unprompted, on top of earlier independent work.",
          }
        : {
            evidenceKind: AssessmentEvidenceKind.explanation,
            level: MasteryLevel.comprehension,
            evidenceNote: "Explained why the answer works, unprompted.",
          };
    }
    case "transfer": {
      if (!observation.correct) return NO_MASTERY_EVIDENCE;
      return {
        evidenceKind: AssessmentEvidenceKind.transfer,
        level: MasteryLevel.mastery,
        evidenceNote: "Used the skill in a new context without help.",
      };
    }
  }
}

/**
 * How many prior independent-evidence successes a learner has on a subject
 * and skill — the consistency signal `classifyMastery` steps from
 * comprehension up to the application level. Rows from other subjects or
 * skills do not count.
 */
export function independentSuccessCount(
  rows: ReadonlyArray<{
    subject: string;
    skill: string | null;
    evidenceKind: AssessmentEvidenceKind;
  }>,
  subject: string,
  skill: string | null,
): number {
  return rows.filter(
    (row) =>
      row.subject === subject &&
      (row.skill ?? null) === skill &&
      row.evidenceKind !== AssessmentEvidenceKind.recall,
  ).length;
}
