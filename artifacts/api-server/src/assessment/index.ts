// Public surface of the assessment engine. The sessions flow records
// assessments from turn evidence via recordAssessment/classifyMastery; the
// dashboards and adaptive engine consume detectGaps/selectExercises.
export {
  classifyMastery,
  independentSuccessCount,
  masteryObservationSchema,
  NO_MASTERY_EVIDENCE,
  type ClassificationContext,
  type MasteryClassification,
  type MasteryObservation,
  type PairedEvidenceLevel,
} from "./classify";
export {
  composeAssessmentRow,
  drizzleAssessmentStore,
  recordAssessment,
  EvidenceRuleError,
  type AssessmentStore,
  type RecordAssessmentInput,
} from "./record";
export {
  detectGaps,
  selectExercises,
  type DetectGapsOptions,
  type LearningGap,
  type SelectExercisesOptions,
  type TargetedExercise,
} from "./exercises";
