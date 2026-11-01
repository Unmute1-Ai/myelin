// Persistent session data (spec §5): the port the routes/pipeline program
// against, plus the Drizzle adapter over tutoring_sessions/session_turns/
// session_materials. Turn writes allocate `seq` inside a transaction that
// locks the session row, so concurrent turns can never share a sequence
// number (unique index is the backstop).

import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  sessionMaterials,
  sessionTurns,
  tutoringSessions,
} from "@workspace/db/schema";
import type {
  SessionMaterial,
  SessionTurn,
  TutoringSession,
} from "@workspace/api-zod";

/** A tutor turn to store — position fidelity travels with the row (spec §5). */
export interface NewTutorTurn {
  readonly content: string;
  readonly kind?: "teach" | "advance" | "reteach";
  readonly stepId?: string;
  readonly strategyId?: string | null;
}

export interface PendingProposal {
  readonly action: "advance_step" | "mark_mastered" | "assign_practice";
  readonly checkLine: string;
}

export interface SessionDataPort {
  createSession(studentId: string, title: string | null): Promise<TutoringSession>;
  listSessions(
    studentId: string,
    status: "active" | "completed" | null,
    limit: number,
  ): Promise<TutoringSession[]>;
  getSession(sessionId: string): Promise<TutoringSession | undefined>;
  /** Cascade removes the session's turns and materials; the audit trail keeps the record. */
  deleteSession(sessionId: string): Promise<void>;
  listTurns(sessionId: string, after: number, limit: number): Promise<SessionTurn[]>;
  /** Append turns after existing rows; returns the stored rows with ids. */
  appendTurns(
    sessionId: string,
    turns: {
      student: { content: string } | null;
      tutor: readonly NewTutorTurn[];
    },
  ): Promise<SessionTurn[]>;
  /** Store or clear the pending Sentinel proposal (spec §6.11). */
  setPending(sessionId: string, pending: PendingProposal | null): Promise<TutoringSession>;
  /**
   * Atomically remove and return the pending proposal, or null when nothing
   * is pending. The single consumer of an execution — two confirm calls can
   * never both execute the same proposal.
   */
  consumePending(
    sessionId: string,
  ): Promise<{ action: PendingProposal["action"]; checkLine: string } | null>;
  insertMaterial(material: {
    sessionId: string;
    studentId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    contentText: string;
  }): Promise<SessionMaterial>;
  listMaterials(sessionId: string): Promise<SessionMaterial[]>;
  /**
   * Server-side retrieval input: the extracted text with provenance. Never
   * exposed over the API — retrieval reads the session's own rows only.
   */
  listMaterialContents(sessionId: string): Promise<
    {
      materialId: string;
      filename: string;
      content: string;
      createdAt: Date;
    }[]
  >;
  completeSession(sessionId: string): Promise<void>;
}

function toSessionDto(row: typeof tutoringSessions.$inferSelect): TutoringSession {
  return {
    id: row.id,
    studentId: row.studentId,
    title: row.title,
    status: row.status,
    startedAt: row.startedAt,
    lastTurnAt: row.lastTurnAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    pendingAction: row.pendingAction,
    pendingCheckLine: row.pendingCheckLine,
  };
}

function toTurnDto(row: typeof sessionTurns.$inferSelect): SessionTurn {
  return {
    id: row.id,
    sessionId: row.sessionId,
    seq: row.seq,
    author: row.author,
    content: row.content,
    strategyId: row.strategyId,
    kind: (row.kind as SessionTurn["kind"]) ?? null,
    stepId: row.stepId,
    createdAt: row.createdAt,
  };
}

export function drizzleSessionData(db: NodePgDatabase): SessionDataPort {
  return {
    async createSession(studentId, title) {
      const [row] = await db
        .insert(tutoringSessions)
        .values({ studentId, title })
        .returning();
      if (!row) throw new Error("session insert returned no row");
      return toSessionDto(row);
    },

    async listSessions(studentId, status, limit) {
      const rows = await db
        .select()
        .from(tutoringSessions)
        .where(
          status === null
            ? eq(tutoringSessions.studentId, studentId)
            : and(
                eq(tutoringSessions.studentId, studentId),
                eq(tutoringSessions.status, status),
              ),
        )
        .orderBy(desc(tutoringSessions.lastTurnAt))
        .limit(limit);
      return rows.map(toSessionDto);
    },

    async getSession(sessionId) {
      const [row] = await db
        .select()
        .from(tutoringSessions)
        .where(eq(tutoringSessions.id, sessionId))
        .limit(1);
      return row ? toSessionDto(row) : undefined;
    },

    async deleteSession(sessionId) {
      // Turns and materials cascade (schema FKs); the audit trail keeps the
      // deletion record for the student's own session.
      await db.delete(tutoringSessions).where(eq(tutoringSessions.id, sessionId));
    },

    async listTurns(sessionId, after, limit) {
      const rows = await db
        .select()
        .from(sessionTurns)
        .where(
          after > 0
            ? and(eq(sessionTurns.sessionId, sessionId), sql`${sessionTurns.seq} > ${after}`)
            : eq(sessionTurns.sessionId, sessionId),
        )
        .orderBy(asc(sessionTurns.seq))
        .limit(limit);
      return rows.map(toTurnDto);
    },

    async appendTurns(sessionId, turns) {
      return db.transaction(async (tx) => {
        // Lock the session row: concurrent turn writes serialize here, so the
        // computed seq base can't race (unique(sessionId, seq) backstops).
        await tx.execute(
          sql`select id from ${tutoringSessions} where id = ${sessionId} for update`,
        );
        const [row] = await tx
          .select({ maxSeq: sql<number | null>`max(${sessionTurns.seq})` })
          .from(sessionTurns)
          .where(eq(sessionTurns.sessionId, sessionId));

        const values: (typeof sessionTurns.$inferInsert)[] = [];
        let seq = row?.maxSeq ?? -1;
        if (turns.student) {
          seq += 1;
          values.push({ sessionId, seq, author: "student", content: turns.student.content });
        }
        for (const t of turns.tutor) {
          seq += 1;
          values.push({
            sessionId,
            seq,
            author: "tutor",
            content: t.content,
            kind: t.kind,
            stepId: t.stepId,
            strategyId: t.strategyId ?? null,
          });
        }
        if (values.length === 0) return [];

        const rows = await tx.insert(sessionTurns).values(values).returning();
        await tx
          .update(tutoringSessions)
          .set({ lastTurnAt: new Date() })
          .where(eq(tutoringSessions.id, sessionId));
        return rows.map(toTurnDto);
      });
    },

    async setPending(sessionId, pending) {
      const [row] = await db
        .update(tutoringSessions)
        .set({
          pendingAction: pending?.action ?? null,
          pendingCheckLine: pending?.checkLine ?? null,
        })
        .where(eq(tutoringSessions.id, sessionId))
        .returning();
      if (!row) throw new Error(`session ${sessionId} vanished while setting pending state`);
      return toSessionDto(row);
    },

    async consumePending(sessionId) {
      // Read-then-clear under a row lock: RETURNING on an UPDATE reports the
      // NEW row values, so a single UPDATE … SET null … RETURNING could never
      // see the proposal it clears. FOR UPDATE serializes competing confirms —
      // the loser sees the cleared row and gets null, never a double execution.
      return db.transaction(async (tx) => {
        const result = await tx.execute(
          sql`select pending_action as action, pending_check_line as check_line
              from ${tutoringSessions}
              where id = ${sessionId}
              for update`,
        );
        const row = result.rows[0] as { action: PendingProposal["action"] | null; check_line: string | null } | undefined;
        if (!row?.action) return null;
        await tx
          .update(tutoringSessions)
          .set({ pendingAction: null, pendingCheckLine: null })
          .where(eq(tutoringSessions.id, sessionId));
        return { action: row.action, checkLine: row.check_line ?? "" };
      });
    },

    async insertMaterial(material) {
      const [row] = await db.insert(sessionMaterials).values(material).returning();
      if (!row) throw new Error("material insert returned no row");
      return {
        id: row.id,
        sessionId: row.sessionId,
        studentId: row.studentId,
        filename: row.filename,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        contentChars: row.contentText.length,
        createdAt: row.createdAt,
      };
    },

    async listMaterials(sessionId) {
      const rows = await db
        .select()
        .from(sessionMaterials)
        .where(eq(sessionMaterials.sessionId, sessionId))
        .orderBy(asc(sessionMaterials.createdAt));
      // Metadata only — extracted text never echoes over the list path.
      return rows.map((row) => ({
        id: row.id,
        sessionId: row.sessionId,
        studentId: row.studentId,
        filename: row.filename,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        contentChars: row.contentText.length,
        createdAt: row.createdAt,
      }));
    },

    async listMaterialContents(sessionId) {
      const rows = await db
        .select()
        .from(sessionMaterials)
        .where(eq(sessionMaterials.sessionId, sessionId))
        .orderBy(asc(sessionMaterials.createdAt));
      return rows.map((row) => ({
        materialId: row.id,
        filename: row.filename,
        content: row.contentText,
        createdAt: row.createdAt,
      }));
    },

    async completeSession(sessionId) {
      await db
        .update(tutoringSessions)
        .set({ status: "completed", endedAt: new Date() })
        .where(eq(tutoringSessions.id, sessionId));
    },
  };
}
