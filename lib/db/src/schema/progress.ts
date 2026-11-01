import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { progressEventKind } from "./enums";
import { users } from "./users";
import { tutoringSessions } from "./tutoring";

/**
 * Append-only timeline for the parent/educator/student dashboards (spec §5).
 * Written by the engines; never updated or deleted through app flows.
 */
export const progressEvents = pgTable(
  "progress_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    sessionId: uuid("session_id").references(() => tutoringSessions.id, {
      onDelete: "set null",
    }),
    kind: progressEventKind("kind").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("progress_events_student_created_idx").on(t.studentId, t.createdAt),
  ],
);

export const progressEventsRelations = relations(progressEvents, ({ one }) => ({
  student: one(users, {
    fields: [progressEvents.studentId],
    references: [users.id],
  }),
  actor: one(users, {
    fields: [progressEvents.actorId],
    references: [users.id],
  }),
  session: one(tutoringSessions, {
    fields: [progressEvents.sessionId],
    references: [tutoringSessions.id],
  }),
}));

export type ProgressEvent = typeof progressEvents.$inferSelect;
export type InsertProgressEvent = z.infer<typeof insertProgressEventSchema>;
export const insertProgressEventSchema = createInsertSchema(progressEvents);
