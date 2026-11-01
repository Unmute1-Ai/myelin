import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { auditLog } from "@workspace/db/schema";

export type AuditDecision = "allowed" | "denied";

export interface AuditEntry {
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  decision: AuditDecision;
  authorizationEvidence: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface AuditPort {
  /**
   * Must throw on failure — an unrecorded decision fails the request rather
   * than passing silently (spec §6.11: consequential actions always audited).
   */
  record(entry: AuditEntry): Promise<void>;
}

export function dbAuditLogger<TSchema extends Record<string, unknown>>(
  db: () => NodePgDatabase<TSchema>,
): AuditPort {
  return {
    async record(entry) {
      await db().insert(auditLog).values({
        actorId: entry.actorId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        decision: entry.decision,
        authorizationEvidence: entry.authorizationEvidence,
        metadata: entry.metadata ?? {},
      });
    },
  };
}
