import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { assessmentEvidenceKind, masteryLevel, sessionStatus, turnAuthor } from "./enums";
import { users } from "./users";

/**
 * Persistent tutoring sessions — replaces the MVP's in-memory session store
 * (spec §2, §5). `lastTurnAt` powers "continue learning" resume ordering.
 */
export const tutoringSessions = pgTable(
  "tutoring_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    status: sessionStatus("status").notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastTurnAt: timestamp("last_turn_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /**
     * Sentinel pending state, persisted with the session (spec §6.11): a
     * proposed action parks here until POST /sessions/{id}/confirm executes
     * or clears it — the proposal survives visits and dies unexecuted unless
     * explicitly confirmed. Nullable: no pending action is the normal state.
     *
     * $type carries the Sentinel action enum (contract TutorProposedAction)
     * without a pg enum migration; only setPending writes these columns.
     */
    pendingAction: text("pending_action").$type<
      "advance_step" | "mark_mastered" | "assign_practice" | null
    >(),
    pendingCheckLine: text("pending_check_line"),
  },
  (t) => [
    index("tutoring_sessions_student_idx").on(t.studentId),
    index("tutoring_sessions_student_status_idx").on(t.studentId, t.status),
  ],
);

/**
 * One chat turn. `seq` orders turns within a session; `strategyId` records
 * which teaching strategy produced a tutor turn (visual, step_by_step, …) so
 * the no-repeat selection rule has data to reason over.
 *
 * `revokedAt` is the turn-evidence tombstone (spec §6.0): the row keeps its
 * content for audit, but stops licensing new profile interpretations and
 * invalidates entries already citing it.
 *
 * `kind`/`stepId` preserve the provider's TurnMessage fidelity on restore:
 * `derivePosition` reads them exactly as it reads in-memory history (teach/
 * advance markers carry position; reteach counts attempts), so a session
 * restored from rows behaves identically to one that never left memory.
 */
export const sessionTurns = pgTable(
  "session_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => tutoringSessions.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    author: turnAuthor("author").notNull(),
    content: text("content").notNull(),
    strategyId: text("strategy_id"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    // Position-fidelity marker (teach/advance/reteach); $type without a pg enum
    // migration — only the turn pipeline writes it, from TurnMessage values.
    kind: text("kind").$type<"teach" | "advance" | "reteach" | null>(),
    stepId: text("step_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("session_turns_session_seq_unique").on(t.sessionId, t.seq),
    index("session_turns_session_idx").on(t.sessionId),
  ],
);

/**
 * Mastery evidence. The binding rule (spec §6.3): a correct answer is
 * evidence of memorization/recognition ONLY — comprehension and above require
 * independent application evidence. Enforced twice: by this table's CHECK
 * constraint and by `insertAssessmentSchema` at the application boundary.
 *
 * Revocation is the evidence tombstone (spec §6.0): a revoked row keeps its
 * data but stops licensing new profile interpretations, and entries already
 * citing it are invalidated.
 */
export const assessments = pgTable(
  "assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => tutoringSessions.id, {
      onDelete: "set null",
    }),
    turnId: uuid("turn_id").references(() => sessionTurns.id, {
      onDelete: "set null",
    }),
    subject: text("subject").notNull(),
    skill: text("skill"),
    level: masteryLevel("level").notNull(),
    evidenceKind: assessmentEvidenceKind("evidence_kind").notNull(),
    evidenceNote: text("evidence_note").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("assessments_student_subject_idx").on(t.studentId, t.subject),
    check(
      "assessments_evidence_matches_level",
      sql`(${t.evidenceKind} = 'recall' AND ${t.level} IN ('memorization', 'recognition')) OR (${t.evidenceKind} IN ('application', 'explanation', 'transfer') AND ${t.level} IN ('comprehension', 'application', 'mastery'))`,
    ),
  ],
);

const RECALL_LEVELS: string[] = ["memorization", "recognition"];
const EVIDENCE_LEVELS: string[] = ["comprehension", "application", "mastery"];

/**
 * Insert schema for assessments with the mastery-evidence rule applied at the
 * application boundary (the DB CHECK is the second line of defense).
 */
export const insertAssessmentSchema = createInsertSchema(assessments).superRefine(
  (value, ctx) => {
    const allowed =
      value.evidenceKind === "recall"
        ? RECALL_LEVELS.includes(value.level)
        : EVIDENCE_LEVELS.includes(value.level);
    if (!allowed) {
      ctx.addIssue({
        code: "custom",
        path: ["level"],
        message:
          `Evidence kind "${value.evidenceKind}" cannot support mastery level "${value.level}". ` +
          "A recalled answer only supports memorization or recognition; comprehension and above " +
          "require independent application evidence (PRIMER spec §6.3).",
      });
    }
  },
);

/**
 * A student's own uploaded material (spec §6.7: "RAG over the student's own
 * content"). Text is extracted at upload time and stored — never a binary
 * blob, never another student's row; retrieval (sessions/materials.ts) reads
 * only rows whose studentId matches the session's student.
 */
export const sessionMaterials = pgTable(
  "session_materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => tutoringSessions.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    contentText: text("content_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("session_materials_session_idx").on(t.sessionId),
    index("session_materials_student_idx").on(t.studentId),
  ],
);

export const tutoringSessionsRelations = relations(tutoringSessions, ({ one, many }) => ({
  student: one(users, {
    fields: [tutoringSessions.studentId],
    references: [users.id],
  }),
  turns: many(sessionTurns),
  assessments: many(assessments),
  materials: many(sessionMaterials),
}));

export const sessionTurnsRelations = relations(sessionTurns, ({ one }) => ({
  session: one(tutoringSessions, {
    fields: [sessionTurns.sessionId],
    references: [tutoringSessions.id],
  }),
}));

export const assessmentsRelations = relations(assessments, ({ one }) => ({
  student: one(users, {
    fields: [assessments.studentId],
    references: [users.id],
  }),
  session: one(tutoringSessions, {
    fields: [assessments.sessionId],
    references: [tutoringSessions.id],
  }),
  turn: one(sessionTurns, {
    fields: [assessments.turnId],
    references: [sessionTurns.id],
  }),
}));

export const sessionMaterialsRelations = relations(sessionMaterials, ({ one }) => ({
  session: one(tutoringSessions, {
    fields: [sessionMaterials.sessionId],
    references: [tutoringSessions.id],
  }),
  student: one(users, {
    fields: [sessionMaterials.studentId],
    references: [users.id],
  }),
}));

export type TutoringSession = typeof tutoringSessions.$inferSelect;
export type InsertTutoringSession = z.infer<typeof insertTutoringSessionSchema>;
export type SessionTurn = typeof sessionTurns.$inferSelect;
export type InsertSessionTurn = z.infer<typeof insertSessionTurnSchema>;
export type Assessment = typeof assessments.$inferSelect;
export type InsertAssessment = z.infer<typeof insertAssessmentSchema>;
export type SessionMaterial = typeof sessionMaterials.$inferSelect;
export type InsertSessionMaterial = z.infer<typeof insertSessionMaterialSchema>;
export const insertTutoringSessionSchema = createInsertSchema(tutoringSessions);
export const insertSessionTurnSchema = createInsertSchema(sessionTurns);
export const insertSessionMaterialSchema = createInsertSchema(sessionMaterials);
