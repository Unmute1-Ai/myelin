// The persistent turn pipeline (spec §5, §6.7): one learner turn against a
// Postgres-backed session. Restores history from stored rows, retrieves
// passages from the session's own materials, runs the provider (adaptive
// engine in production), then persists the exchange — student turn, tutor
// turn with position fidelity, pending Sentinel proposal, and the recall
// assessment a correct check answer earns (spec §6.3 cap).

import type { MaterialContext } from "../tutor/session-context";
import type { TurnEvent, TurnMessage, TutorProvider } from "../tutor/types";
import { buildSessionContext } from "../tutor/session-context";
import { DEMO_LESSON } from "../tutor/lesson/money-math";
import type { SessionTurn } from "@workspace/api-zod";
import { retrievePassages, type RetrieveInput } from "./materials";
import type { NewTutorTurn, SessionDataPort } from "./session-service";

/** Cap on history replayed to the provider for one turn. */
export const MAX_HISTORY_TURNS = 200;

/** A pending proposal as the pipeline hands it to the route (spec §6.11). */
export interface ProposedTurnAction {
  readonly action: "advance_step" | "mark_mastered" | "assign_practice";
  readonly checkLine: string;
}

/**
 * Stored rows → provider history. kind/stepId columns carry the position
 * markers, so derivePosition reads a restored session exactly as it reads a
 * live one; unknown kind values (never written by this codebase) degrade to
 * plain conversation turns rather than corrupting position.
 */
export function rowsToHistory(rows: readonly SessionTurn[]): TurnMessage[] {
  return rows.map((row) =>
    row.author === "student"
      ? { role: "learner" as const, content: row.content }
      : {
          role: "tutor" as const,
          content: row.content,
          ...(row.kind !== null ? { kind: row.kind } : {}),
          ...(row.stepId !== null ? { stepId: row.stepId } : {}),
          ...(row.strategyId !== null ? { strategyId: row.strategyId } : {}),
        },
  );
}

/** The recall assessment a correct check answer earns (spec §6.3 — capped at recognition). */
export interface RecallAssessment {
  readonly studentId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly subject: string;
  readonly skill: string | null;
  readonly level: "recognition";
  readonly evidenceKind: "recall";
  readonly evidenceNote: string;
}

/**
 * A proposed advance_step means the check just passed — the learner's typed
 * answer matched by meaning. That is recall evidence, and recall supports
 * memorization/recognition only (the §6.3 pairing rule; the DB CHECK is the
 * second line of defense). Independent-application evidence comes from the
 * assessment flows, not from a chat check.
 */
export function assessmentFromCorrectGrade(
  studentId: string,
  sessionId: string,
  studentTurnId: string,
  gradingStepId: string | null,
): RecallAssessment | null {
  const step = gradingStepId !== null ? DEMO_LESSON.steps.find((s) => s.id === gradingStepId) : undefined;
  if (step === undefined) return null;
  return {
    studentId,
    sessionId,
    turnId: studentTurnId,
    subject: "math",
    skill: step.concept,
    level: "recognition",
    evidenceKind: "recall",
    evidenceNote: `Correct check answer for "${step.concept}" — typed answer matched by meaning (recall evidence; recognition cap per PRIMER spec §6.3).`,
  };
}

/** Accumulate provider events into the reply pieces the route persists. */
export interface CollectedTurn {
  readonly content: string;
  readonly spoken: string;
  readonly kind: "teach" | "advance" | "reteach" | null;
  readonly stepId: string | null;
  readonly strategyId: string | null;
  readonly proposed: ProposedTurnAction | null;
}

/** The one place event-stream shape is flattened into a storable turn. */
export function collectTurnEvents(events: readonly TurnEvent[]): CollectedTurn {
  const deltas: string[] = [];
  let spoken = "";
  let kind: CollectedTurn["kind"] = null;
  let stepId: string | null = null;
  let strategyId: string | null = null;
  let proposed: CollectedTurn["proposed"] = null;

  for (const event of events) {
    if (event.type === "text") {
      deltas.push(event.delta);
      // Later events win — the tag on the message a learner sees is the
      // strategy that finished speaking.
      if (event.kind !== undefined) kind = event.kind;
      if (event.stepId !== undefined) stepId = event.stepId;
      if (event.strategyId !== undefined) strategyId = event.strategyId;
    } else if (event.type === "proposed_action") {
      proposed = { action: event.action, checkLine: event.checkLine };
    } else {
      spoken = event.spoken;
    }
  }

  return { content: deltas.join("\n\n"), spoken, kind, stepId, strategyId, proposed };
}

/** Retrieve passages for this input from the session's own materials only. */
export function materialContextFor(
  query: string,
  materials: readonly RetrieveInput[],
): MaterialContext[] | undefined {
  // No materials on the session → no context key at all (the provider's
  // material branch cannot fire). Materials present → attach even when
  // retrieval matched nothing, so the tutor answers from the honest
  // "nothing matches yet" variant instead of pretending.
  if (materials.length === 0) return undefined;
  return retrievePassages(query, materials, { limit: 3 });
}

export interface RunTurnOptions {
  readonly studentId: string;
  readonly sessionId: string;
  readonly content: string;
}

export interface PersistedExchange {
  readonly studentTurn: SessionTurn;
  readonly tutorTurn: SessionTurn;
  readonly spoken: string;
  readonly recordedAssessments: readonly RecallAssessment[];
}

/**
 * The full turn: restore → retrieve → generate → persist. The data port and
 * provider are injected; the route owns authorization, the pending-proposal
 * write, and the HTTP shape.
 */
export async function runLearnerTurn(
  data: SessionDataPort,
  provider: TutorProvider,
  options: RunTurnOptions,
): Promise<{ exchange: PersistedExchange; proposed: ProposedTurnAction | null }> {
  const { studentId, sessionId, content } = options;

  const [rows, materials] = await Promise.all([
    data.listTurns(sessionId, 0, MAX_HISTORY_TURNS),
    data.listMaterialContents(sessionId),
  ]);
  const history = rowsToHistory(rows);
  const materialContext = materialContextFor(content, materials);

  const ctx = buildSessionContext(history, DEMO_LESSON, content, sessionId, materialContext);
  const collected = collectTurnEvents(await toArray(provider.turn(ctx)));

  // One transactional append: the student turn then the tutor turn, in order.
  const stored = await data.appendTurns(sessionId, {
    student: { content },
    tutor: [
      {
        content: collected.content,
        kind: collected.kind ?? undefined,
        stepId: collected.stepId ?? undefined,
        strategyId: collected.strategyId,
      },
    ],
  });
  const studentTurn = stored.find((t) => t.author === "student");
  const tutorTurn = stored.find((t) => t.author === "tutor");
  if (!studentTurn || !tutorTurn) throw new Error("appendTurns did not persist the exchange");

  const assessment =
    collected.proposed?.action === "advance_step"
      ? assessmentFromCorrectGrade(studentId, sessionId, studentTurn.id, collected.stepId)
      : null;

  return {
    exchange: {
      studentTurn,
      tutorTurn,
      spoken: collected.spoken,
      recordedAssessments: assessment ? [assessment] : [],
    },
    proposed: collected.proposed,
  };
}

async function toArray(stream: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
