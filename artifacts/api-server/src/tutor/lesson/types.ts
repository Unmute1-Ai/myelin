// Demo lesson shape (Primer MVP spec, section 2). Content lives behind this
// interface so the subject swaps with zero architectural change.

export interface LessonCheck {
  /** Check question asked of the learner. */
  question: string;
  /**
   * Numeric answers accepted as meaning-correct. Grading extracts numbers
   * from the learner's input (digits or words, units ignored) — fragments and
   * unusual grammar never block meaning. Never string-matched.
   */
  acceptedNumbers: readonly number[];
  /** Warm, shame-free hint used when the answer isn't in yet. No grammar commentary, ever. */
  stuckReply: string;
  /** Celebration of a correct answer (before any correction — there is none to make here). */
  onCorrect: string;
}

export interface LessonStep {
  id: string;
  /** Concept name used in the Sentinel check line. */
  concept: string;
  /** Short spoken explanation — voice output only. */
  spoken: string;
  /** Full teaching content, including the worked example — on screen, not in the voice. */
  teaching: string;
  check: LessonCheck;
}

export interface DemoLesson {
  id: string;
  title: string;
  steps: readonly LessonStep[];
}
