import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { pilotProposalStatus, textSize } from "./enums";
import { users } from "./users";

/**
 * Pilot enrollment (U1Si-Q pilot). Three tables:
 *
 * - `pilot_invites` — server-stored invite codes the founder issues.
 *   Self-serve registration requires a valid, unexpired, unused code; the
 *   code is consumed atomically so one invite enrolls exactly one person.
 * - `pilot_enrollments` — one per pilot participant: contact method,
 *   accessibility preferences (aligned with the `accessibility_prefs`
 *   column vocabulary), and the consent flags together with the exact
 *   data-flow disclosure text that was in force at enrollment.
 * - `pilot_proposals` — the persistent parking spot for generalized
 *   Sentinel proposals: pending state a human decides exactly once.
 */

export const pilotInvites = pgTable(
  "pilot_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    issuedBy: uuid("issued_by").references(() => users.id, {
      onDelete: "set null",
    }),
    note: text("note").notNull().default(""),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Set atomically at enrollment — one invite enrolls exactly one person. */
    usedAt: timestamp("used_at", { withTimezone: true }),
    usedBy: uuid("used_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [check("pilot_invites_code_not_empty", sql`length(${t.code}) > 0`)],
);

export const pilotEnrollments = pgTable(
  "pilot_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    inviteId: uuid("invite_id").references(() => pilotInvites.id, {
      onDelete: "set null",
    }),
    /** How the pilot team reaches the participant, plus the value itself. */
    contactMethod: text("contact_method").notNull(),
    contactValue: text("contact_value").notNull(),
    // Accessibility preferences — the same vocabulary as accessibility_prefs
    // (spec §6.8); a subset, because the pilot needs only the visual/input
    // settings to prepare sessions. Keyboard navigation and screen-reader
    // support are always-on platform behavior, not preferences.
    captionsEnabled: boolean("captions_enabled").notNull().default(true),
    textSize: textSize("text_size").notNull().default("medium"),
    aacInputEnabled: boolean("aac_input_enabled").notNull().default(false),
    reducedMotion: boolean("reduced_motion").notNull().default(false),
    // Consent flags with the disclosure trail: the exact data-flow text shown
    // before consent, and the consent version it belonged to. Append-only in
    // spirit — updates write updatedAt, never rewrite the disclosure.
    consentToParticipate: boolean("consent_to_participate").notNull(),
    consentToLearningData: boolean("consent_to_learning_data").notNull(),
    dataFlowDisclosure: text("data_flow_disclosure").notNull(),
    consentVersion: text("consent_version").notNull(),
    /** Where the enrollment came from — the invite-code path, for now. */
    source: text("source").notNull().default("invite_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // No enrollment without participation consent — the DB enforces the
    // floor the form advertises.
    check(
      "pilot_enrollments_participation_consented",
      sql`${t.consentToParticipate} IS TRUE`,
    ),
    check(
      "pilot_enrollments_disclosure_recorded",
      sql`length(${t.dataFlowDisclosure}) > 0`,
    ),
  ],
);

export const pilotProposals = pgTable(
  "pilot_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** A GATED_ACTIONS key — validated against the registry, not free text. */
    action: text("action").notNull(),
    status: pilotProposalStatus("status").notNull().default("pending"),
    /**
     * The exactly-once claim: set atomically when a decision takes the
     * pending proposal. A row with status 'pending' and a consumedAt stamp
     * is the crash window — claimed but not decided, never executed.
     */
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    /** The human-readable question surfaced to the approver. */
    checkLine: text("check_line").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    proposedBy: uuid("proposed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedBy: uuid("decided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Populated only on the executed path — the one execution's effect. */
    result: jsonb("result").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("pilot_proposals_status_created_idx").on(t.status, t.createdAt)],
);

export const pilotInvitesRelations = relations(pilotInvites, ({ one }) => ({
  issuer: one(users, {
    fields: [pilotInvites.issuedBy],
    references: [users.id],
    relationName: "pilot_invite_issuer",
  }),
  usedByUser: one(users, {
    fields: [pilotInvites.usedBy],
    references: [users.id],
    relationName: "pilot_invite_used_by",
  }),
  enrollment: one(pilotEnrollments, {
    fields: [pilotInvites.id],
    references: [pilotEnrollments.inviteId],
  }),
}));

export const pilotEnrollmentsRelations = relations(pilotEnrollments, ({ one }) => ({
  user: one(users, {
    fields: [pilotEnrollments.userId],
    references: [users.id],
  }),
  invite: one(pilotInvites, {
    fields: [pilotEnrollments.inviteId],
    references: [pilotInvites.id],
  }),
}));

export const pilotProposalsRelations = relations(pilotProposals, ({ one }) => ({
  proposer: one(users, {
    fields: [pilotProposals.proposedBy],
    references: [users.id],
  }),
  decider: one(users, {
    fields: [pilotProposals.decidedBy],
    references: [users.id],
  }),
}));

export type PilotInvite = typeof pilotInvites.$inferSelect;
export type InsertPilotInvite = z.infer<typeof insertPilotInviteSchema>;
export const insertPilotInviteSchema = createInsertSchema(pilotInvites);

export type PilotEnrollment = typeof pilotEnrollments.$inferSelect;
export type InsertPilotEnrollment = z.infer<typeof insertPilotEnrollmentSchema>;
export const insertPilotEnrollmentSchema = createInsertSchema(pilotEnrollments);

export type PilotProposal = typeof pilotProposals.$inferSelect;
export type InsertPilotProposal = z.infer<typeof insertPilotProposalSchema>;
export const insertPilotProposalSchema = createInsertSchema(pilotProposals);
