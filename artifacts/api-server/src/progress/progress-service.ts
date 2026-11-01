import { and, desc, eq, gt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { progressEvents, type ProgressEvent } from "@workspace/db/schema";
import { studentExists } from "../profiles/profile-service";

/**
 * The progress-timeline data plane for the dashboards (spec §5, §6.7, §6.9).
 * The timeline is append-only: this port intentionally exposes reads only —
 * rows are written by the engines (assessments, adaptive teaching), never by
 * the dashboards. Authorization (who may read which student's timeline)
 * lives in `authorize()` at the route layer.
 */

/** Validated query shapes — kind/since filter, limit capped by the contract. */
export interface ProgressQuery {
  kind?: ProgressEvent["kind"];
  since?: Date;
  limit: number;
}

export interface ProgressDataPort {
  /** The path student exists and is a student (contract 404 otherwise). */
  studentExists(studentId: string): Promise<boolean>;
  /** Timeline rows, newest first. */
  listProgressEvents(studentId: string, query: ProgressQuery): Promise<ProgressEvent[]>;
}

export function drizzleProgressData(db: () => NodePgDatabase): ProgressDataPort {
  return {
    // Same existence semantics as the profile routes: the user must exist and
    // hold the student role (a parent id in the path is a 404, not a leak).
    async studentExists(studentId) {
      return studentExists(db(), studentId);
    },

    async listProgressEvents(studentId, query) {
      const filters = [eq(progressEvents.studentId, studentId)];
      if (query.kind) filters.push(eq(progressEvents.kind, query.kind));
      if (query.since) filters.push(gt(progressEvents.createdAt, query.since));

      return db()
        .select()
        .from(progressEvents)
        .where(and(...filters))
        .orderBy(desc(progressEvents.createdAt))
        .limit(query.limit);
    },
  };
}
