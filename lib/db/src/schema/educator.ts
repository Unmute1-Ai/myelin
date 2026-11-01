import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { assignmentStatus, consentStatus } from "./enums";
import { users } from "./users";

/**
 * The educator linking model (spec §6.10). An educator sees a student's
 * learning data only through a link an admin granted — request → admin
 * approval → access; the approval is the human authorization decision
 * ("interpretation is not authorization"). A pending or revoked link grants
 * nothing; `authorize()` checks the live status server-side, the FKs keep
 * referential integrity. No consent rows hang off educator links: the
 * guardian consent trail (users.ts) covers family access; this is the school
 * relationship, and its gate is the admin's recorded grant.
 */
export const educatorLinks = pgTable(
  "educator_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    educatorId: uuid("educator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: consentStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("educator_links_educator_student_unique").on(t.educatorId, t.studentId),
    index("educator_links_student_idx").on(t.studentId),
    check("educator_links_not_self", sql`${t.educatorId} <> ${t.studentId}`),
  ],
);

/**
 * Work an educator assigns to a linked student (spec §6.10). Assignments are
 * educator-authored classroom data — they never touch the evidence-governed
 * learning record (profile entries stay evidence-cited, spec §6.0), and the
 * authorization boundary decides which educator may create one for which
 * student.
 */
export const educatorAssignments = pgTable(
  "educator_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    educatorId: uuid("educator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    detail: text("detail"),
    subject: text("subject"),
    status: assignmentStatus("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("educator_assignments_student_idx").on(t.studentId),
    index("educator_assignments_educator_idx").on(t.educatorId),
  ],
);

/**
 * One support plan per student (unique `studentId`), written by a linked
 * educator (spec §6.10 "supports configuration"). Entries are non-diagnostic
 * classroom supports ("visual schedules", "movement breaks") — never a
 * condition, label, or inferred disability; the schema has no diagnosis field
 * anywhere, by design. `updatedBy` keeps the human trail behind the last edit.
 */
export const educatorSupports = pgTable(
  "educator_supports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    supports: text("supports")
      .array()
      .notNull()
      .default([]),
    notes: text("notes"),
    updatedBy: uuid("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const educatorLinksRelations = relations(educatorLinks, ({ one }) => ({
  educator: one(users, {
    fields: [educatorLinks.educatorId],
    references: [users.id],
    relationName: "educator_link_educator",
  }),
  student: one(users, {
    fields: [educatorLinks.studentId],
    references: [users.id],
    relationName: "educator_link_student",
  }),
}));

export const educatorAssignmentsRelations = relations(educatorAssignments, ({ one }) => ({
  educator: one(users, {
    fields: [educatorAssignments.educatorId],
    references: [users.id],
    relationName: "educator_assignment_educator",
  }),
  student: one(users, {
    fields: [educatorAssignments.studentId],
    references: [users.id],
  }),
}));

export const educatorSupportsRelations = relations(educatorSupports, ({ one }) => ({
  student: one(users, {
    fields: [educatorSupports.studentId],
    references: [users.id],
  }),
  updater: one(users, {
    fields: [educatorSupports.updatedBy],
    references: [users.id],
    relationName: "educator_supports_updater",
  }),
}));

export type EducatorLink = typeof educatorLinks.$inferSelect;
export type InsertEducatorLink = z.infer<typeof insertEducatorLinkSchema>;
export type EducatorAssignment = typeof educatorAssignments.$inferSelect;
export type InsertEducatorAssignment = z.infer<typeof insertEducatorAssignmentSchema>;
export type EducatorSupports = typeof educatorSupports.$inferSelect;
export type InsertEducatorSupports = z.infer<typeof insertEducatorSupportsSchema>;
export const insertEducatorLinkSchema = createInsertSchema(educatorLinks);
export const insertEducatorAssignmentSchema = createInsertSchema(educatorAssignments);
export const insertEducatorSupportsSchema = createInsertSchema(educatorSupports);
