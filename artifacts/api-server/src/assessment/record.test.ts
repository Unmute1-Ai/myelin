// The assessment write boundary (spec §6.3): rows are written WITH their
// evidence, illegal pairings are rejected before they reach the store, and
// every recorded assessment lands on the learner's timeline. The store is a
// port — an in-memory fake here, drizzle in production — so no live database
// is needed to prove the rules.
import { describe, expect, it } from "vitest";
import {
  AssessmentEvidenceKind,
  MasteryLevel,
  type Assessment as AssessmentDto,
} from "@workspace/api-zod";
import type { Assessment, InsertAssessment, InsertProgressEvent } from "@workspace/db/schema";
import {
  composeAssessmentRow,
  EvidenceRuleError,
  recordAssessment,
  type AssessmentStore,
  type RecordAssessmentInput,
} from "./record";

const STUDENT_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000002";
const TURN_ID = "00000000-0000-4000-8000-000000000003";
const SAVED_ID = "00000000-0000-4000-8000-000000000004";

function fakeStore() {
  const attempted: InsertAssessment[] = [];
  const saved: Assessment[] = [];
  const events: InsertProgressEvent[] = [];
  const store: AssessmentStore = {
    async insertAssessment(row) {
      attempted.push(row);
      const record: Assessment = {
        ...row,
        sessionId: row.sessionId ?? null,
        turnId: row.turnId ?? null,
        skill: row.skill ?? null,
        id: SAVED_ID,
        createdAt: new Date("2026-11-01T10:00:00.000Z"),
      };
      saved.push(record);
      return record;
    },
    async recordProgressEvent(event) {
      events.push(event);
    },
  };
  return { store, attempted, saved, events };
}

/** Compile-time pin: stored rows are wire-compatible with the contract DTO. */
function toContractDto(row: Assessment): AssessmentDto {
  return { ...row };
}

const validInput: RecordAssessmentInput = {
  studentId: STUDENT_ID,
  sessionId: SESSION_ID,
  turnId: TURN_ID,
  subject: "math.money",
  skill: "making_change",
  level: MasteryLevel.comprehension,
  evidenceKind: AssessmentEvidenceKind.application,
  evidenceNote: "Solved a novel change-making problem unaided.",
};

describe("assessment rows written with evidence", () => {
  it("composes a row that keeps the evidence intact", () => {
    const row = composeAssessmentRow(validInput);
    expect(row).toMatchObject({
      studentId: STUDENT_ID,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      subject: "math.money",
      skill: "making_change",
      level: MasteryLevel.comprehension,
      evidenceKind: AssessmentEvidenceKind.application,
      evidenceNote: "Solved a novel change-making problem unaided.",
    });
  });

  it("stores the row and puts an assessment_recorded event on the timeline", async () => {
    const { store, saved, events } = fakeStore();
    const recorded = await recordAssessment(store, validInput);

    expect(recorded.id).toBe(SAVED_ID);
    expect(saved).toHaveLength(1);
    expect(events).toEqual([
      expect.objectContaining({
        studentId: STUDENT_ID,
        sessionId: SESSION_ID,
        kind: "assessment_recorded",
      }),
    ]);
    expect(events[0]?.summary).toContain("comprehension");
    expect(events[0]?.summary).toContain("math.money · making_change");
    expect(events[0]?.payload).toMatchObject({
      assessmentId: SAVED_ID,
      level: MasteryLevel.comprehension,
      evidenceKind: AssessmentEvidenceKind.application,
    });
  });

  it("returns rows the platform contract accepts as Assessments", async () => {
    const { store } = fakeStore();
    const recorded = await recordAssessment(store, validInput);
    // Type-level: the row satisfies the generated contract DTO.
    const dto: AssessmentDto = toContractDto(recorded);
    expect(dto.evidenceNote).toBe(recorded.evidenceNote);
  });
});

describe("misclassification rejection at the write boundary", () => {
  // Runtime producers (deserialized JSON, an LLM-proposed classification) can
  // lie about their types — these casts simulate exactly that.
  const lyingPair = (evidenceKind: string, level: string) =>
    ({ ...validInput, evidenceKind, level }) as unknown as RecordAssessmentInput;

  it("rejects a recalled answer claiming comprehension", () => {
    expect(() =>
      composeAssessmentRow(lyingPair(AssessmentEvidenceKind.recall, MasteryLevel.comprehension)),
    ).toThrow(EvidenceRuleError);
  });

  it("rejects a recalled answer claiming mastery", () => {
    expect(() =>
      composeAssessmentRow(lyingPair(AssessmentEvidenceKind.recall, MasteryLevel.mastery)),
    ).toThrow(/recall/i);
  });

  it("rejects independent evidence claiming only memorization", () => {
    expect(() =>
      composeAssessmentRow(lyingPair(AssessmentEvidenceKind.application, MasteryLevel.memorization)),
    ).toThrow(EvidenceRuleError);
  });

  it("never lets an illegal pairing reach the store", async () => {
    const { store, attempted, events } = fakeStore();
    await expect(
      recordAssessment(store, lyingPair(AssessmentEvidenceKind.recall, MasteryLevel.comprehension)),
    ).rejects.toThrow(EvidenceRuleError);
    expect(attempted).toEqual([]);
    expect(events).toEqual([]);
  });
});
