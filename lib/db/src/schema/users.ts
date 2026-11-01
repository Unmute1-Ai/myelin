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
import { consentStatus, consentType, userRole } from "./enums";

/**
 * Accounts for every role on the platform. Password hashing (argon2) is owned
 * by the auth task; this table only stores the hash.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull().default("student"),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Parent ↔ child relationship. A parent may only see a student through a
 * granted link — `authorize()` checks this server-side, the FK just keeps
 * referential integrity. Consent status is the current state; `consents`
 * below is the immutable record trail behind it.
 */
export const guardianLinks = pgTable(
  "guardian_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id")
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
    unique("guardian_links_parent_student_unique").on(t.parentId, t.studentId),
    index("guardian_links_student_idx").on(t.studentId),
    check("guardian_links_not_self", sql`${t.parentId} <> ${t.studentId}`),
  ],
);

/**
 * Explicit consent records behind a guardian link (spec: type, granted/
 * revoked at, version of terms). Append-only: revocation writes `revokedAt`,
 * it never rewrites the grant.
 */
export const consents = pgTable(
  "consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guardianLinkId: uuid("guardian_link_id")
      .notNull()
      .references(() => guardianLinks.id, { onDelete: "cascade" }),
    type: consentType("type").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    termsVersion: text("terms_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("consents_guardian_link_idx").on(t.guardianLinkId)],
);

export const guardianLinksRelations = relations(guardianLinks, ({ one, many }) => ({
  parent: one(users, {
    fields: [guardianLinks.parentId],
    references: [users.id],
    relationName: "guardian_link_parent",
  }),
  student: one(users, {
    fields: [guardianLinks.studentId],
    references: [users.id],
    relationName: "guardian_link_student",
  }),
  consents: many(consents),
}));

export const consentsRelations = relations(consents, ({ one }) => ({
  guardianLink: one(guardianLinks, {
    fields: [consents.guardianLinkId],
    references: [guardianLinks.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export const insertUserSchema = createInsertSchema(users);

export type GuardianLink = typeof guardianLinks.$inferSelect;
export type InsertGuardianLink = z.infer<typeof insertGuardianLinkSchema>;
export const insertGuardianLinkSchema = createInsertSchema(guardianLinks);

export type Consent = typeof consents.$inferSelect;
export type InsertConsent = z.infer<typeof insertConsentSchema>;
export const insertConsentSchema = createInsertSchema(consents);
