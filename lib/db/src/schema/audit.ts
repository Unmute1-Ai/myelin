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
import { auditDecision } from "./enums";
import { users } from "./users";

/**
 * Append-only trail for every consequential action (spec §6.11): who, what,
 * on which resource, allowed or denied, and the authorization evidence behind
 * the decision ("Interpretation is not authorization"). Never updated or
 * deleted through app flows. Actor is nullable — system actions keep working
 * when an account is deleted (set null), and the row itself must survive.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    decision: auditDecision("decision").notNull(),
    authorizationEvidence: jsonb("authorization_evidence")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_log_actor_created_idx").on(t.actorId, t.createdAt),
    index("audit_log_resource_idx").on(t.resourceType, t.resourceId),
  ],
);

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  actor: one(users, {
    fields: [auditLog.actorId],
    references: [users.id],
  }),
}));

export type AuditLog = typeof auditLog.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export const insertAuditLogSchema = createInsertSchema(auditLog);
