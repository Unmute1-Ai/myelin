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
import { profileEntryKind } from "./enums";
import { users } from "./users";
import { assessments, sessionTurns } from "./tutoring";

/**
 * One per student (unique `studentId`). Subjects and pacing are explicit
 * student/parent choices; `preferredStrategy` is the explicit student strategy
 * pick (e.g. "visual") that always wins strategy selection (spec §6.4).
 */
export const learningProfiles = pgTable(
  "learning_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    subjects: jsonb("subjects").$type<string[]>().notNull().default([]),
    preferredStrategy: text("preferred_strategy"),
    pacing: text("pacing").notNull().default("standard"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

/**
 * The transparent learning record (spec §6.2). Gaps and misconceptions are
 * written from assessment evidence only (FK refs, not vibes). Preferences are
 * explicit-only — this schema has no diagnosis field anywhere, by design.
 * Every strategy change writes a human-readable `whyChanged` note that the UI
 * surfaces back to the learner.
 *
 * Evidence-governance lifecycle (spec §6.0):
 * - Citation FKs are `RESTRICT` — the database itself refuses to hard-delete
 *   evidence a profile entry still cites, so no entry can be ghosted by a
 *   silent `SET NULL`.
 * - `invalidatedAt` / `invalidatedReason` mark entries whose evidence was
 *   revoked. The entry survives (the record stays auditable) but never
 *   presents itself as live interpretation again.
 */
export const profileEntries = pgTable(
  "profile_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => learningProfiles.id, { onDelete: "cascade" }),
    kind: profileEntryKind("kind").notNull(),
    subject: text("subject"),
    detail: text("detail").notNull(),
    whyChanged: text("why_changed"),
    sourceAssessmentId: uuid("source_assessment_id").references(() => assessments.id, {
      onDelete: "restrict",
    }),
    sourceTurnId: uuid("source_turn_id").references(() => sessionTurns.id, {
      onDelete: "restrict",
    }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    invalidatedReason: text("invalidated_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("profile_entries_profile_idx").on(t.profileId),
    index("profile_entries_profile_kind_idx").on(t.profileId, t.kind),
  ],
);

export const learningProfilesRelations = relations(learningProfiles, ({ one, many }) => ({
  student: one(users, {
    fields: [learningProfiles.studentId],
    references: [users.id],
  }),
  entries: many(profileEntries),
}));

export const profileEntriesRelations = relations(profileEntries, ({ one }) => ({
  profile: one(learningProfiles, {
    fields: [profileEntries.profileId],
    references: [learningProfiles.id],
  }),
  sourceAssessment: one(assessments, {
    fields: [profileEntries.sourceAssessmentId],
    references: [assessments.id],
  }),
  sourceTurn: one(sessionTurns, {
    fields: [profileEntries.sourceTurnId],
    references: [sessionTurns.id],
  }),
}));

export type LearningProfile = typeof learningProfiles.$inferSelect;
export type InsertLearningProfile = z.infer<typeof insertLearningProfileSchema>;
export type ProfileEntry = typeof profileEntries.$inferSelect;
export type InsertProfileEntry = z.infer<typeof insertProfileEntrySchema>;
export const insertLearningProfileSchema = createInsertSchema(learningProfiles);
export const insertProfileEntrySchema = createInsertSchema(profileEntries);
