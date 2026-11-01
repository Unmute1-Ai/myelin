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

export const tutoringSessionsRelations = relations(tutoringSessions, ({ one, many }) => ({
  student: one(users, {
    fields: [tutoringSessions.studentId],
    references: [users.id],
  }),
  turns: many(sessionTurns),
  assessments: many(assessments),
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

export type TutoringSession = typeof tutoringSessions.$inferSelect;
export type InsertTutoringSession = z.infer<typeof insertTutoringSessionSchema>;
export type SessionTurn = typeof sessionTurns.$inferSelect;
export type InsertSessionTurn = z.infer<typeof insertSessionTurnSchema>;
export type Assessment = typeof assessments.$inferSelect;
export type InsertAssessment = z.infer<typeof insertAssessmentSchema>;
export const insertTutoringSessionSchema = createInsertSchema(tutoringSessions);
export const insertSessionTurnSchema = createInsertSchema(sessionTurns);
