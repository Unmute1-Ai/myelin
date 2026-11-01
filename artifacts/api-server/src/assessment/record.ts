// The assessment write boundary (spec §6.3, §5). Every row that enters the
// `assessments` table passes through `insertAssessmentSchema` — the same
// mastery-evidence rule the DB CHECK enforces — so a lying caller (deserialized
// JSON, an LLM-proposed classification) is rejected before it can distort the
// learner's record. Rows are written with their evidence: kind, note, and the
// session/turn that produced them.
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  assessments,
  insertAssessmentSchema,
  progressEvents,
  type Assessment,
  type InsertAssessment,
  type InsertProgressEvent,
} from "@workspace/db/schema";
import type { PairedEvidenceLevel } from "./classify";

/**
 * The input recordAssessment accepts. The evidence/level pairing is checked
 * twice: by `PairedEvidenceLevel` at compile time, and at runtime by
 * `insertAssessmentSchema` (runtime producers can lie about their types).
 */
export type RecordAssessmentInput = PairedEvidenceLevel & {
  studentId: string;
  sessionId?: string | null;
  turnId?: string | null;
  subject: string;
  skill?: string | null;
  evidenceNote: string;
};

/** A proposed row violates the mastery-evidence rule (spec §6.3). */
export class EvidenceRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceRuleError";
  }
}

/**
 * Compose the insertable row at the write boundary. Valid even though the
 * input type already forbids illegal pairings: this function is the runtime
 * gate for producers that don't have the type's guarantee (JSON boundaries).
 */
export function composeAssessmentRow(input: RecordAssessmentInput): InsertAssessment {
  const candidate = {
    studentId: input.studentId,
    sessionId: input.sessionId ?? null,
    turnId: input.turnId ?? null,
    subject: input.subject,
    skill: input.skill ?? null,
    level: input.level,
    evidenceKind: input.evidenceKind,
    evidenceNote: input.evidenceNote,
  };
  const parsed = insertAssessmentSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new EvidenceRuleError(
      `Refusing to record this assessment: ${issue?.message ?? "it violates the mastery-evidence rule (spec §6.3)."}`,
    );
  }
  return parsed.data;
}

/** Persistence port — tests substitute an in-memory fake, no live database. */
export interface AssessmentStore {
  insertAssessment(row: InsertAssessment): Promise<Assessment>;
  recordProgressEvent(event: InsertProgressEvent): Promise<void>;
}

/** Drizzle adapter over the platform database. */
export function drizzleAssessmentStore(db: NodePgDatabase): AssessmentStore {
  return {
    async insertAssessment(row) {
      const [saved] = await db.insert(assessments).values(row).returning();
      return saved;
    },
    async recordProgressEvent(event) {
      await db.insert(progressEvents).values(event);
    },
  };
}

function progressSummary(row: Pick<Assessment, "level" | "subject" | "skill" | "evidenceNote">): string {
  const target = row.skill ? `${row.subject} · ${row.skill}` : row.subject;
  return `${row.level} demonstrated in ${target} — ${row.evidenceNote}`;
}

/**
 * Record one assessment with its evidence and put it on the learner's
 * timeline (`assessment_recorded`). An illegal pairing never reaches the
 * store — compose throws first.
 */
export async function recordAssessment(
  store: AssessmentStore,
  input: RecordAssessmentInput,
): Promise<Assessment> {
  const row = composeAssessmentRow(input);
  const saved = await store.insertAssessment(row);
  await store.recordProgressEvent({
    studentId: saved.studentId,
    sessionId: saved.sessionId,
    kind: "assessment_recorded",
    summary: progressSummary(saved),
    payload: { assessmentId: saved.id, level: saved.level, evidenceKind: saved.evidenceKind },
  });
  return saved;
}
