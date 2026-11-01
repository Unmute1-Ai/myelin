import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { tutoringSessions, type TutoringSession } from "@workspace/db/schema";

/**
 * Persistent tutoring-session reads for the student dashboard (spec §5, §6.7).
 * This port is the dashboard's read plane: "continue learning" picks the
 * resume target from `lastTurnAt`, and "recent sessions" renders the list.
 *
 * Deliberately read-only in this lane — session *writes* (create, turns,
 * completion) belong to the live-tutor flow, which owns the adaptive engine
 * and the Sentinel gate. Route authorization: a student sees their own
 * sessions; parents/educators read through their own consent-gated surfaces,
 * never this one (fail-closed policy, spec §6.1).
 */

export interface SessionsQuery {
  status?: TutoringSession["status"];
  limit: number;
}

export interface SessionsDataPort {
  /** The caller's sessions, most recently active first. */
  listSessions(studentId: string, query: SessionsQuery): Promise<TutoringSession[]>;
}

/** "Most recently active first": lastTurnAt when it exists, else startedAt. */
const MOST_RECENTLY_ACTIVE_FIRST = sql`${tutoringSessions.lastTurnAt} DESC NULLS LAST, ${tutoringSessions.startedAt} DESC`;

export function drizzleSessionsData(db: () => NodePgDatabase): SessionsDataPort {
  return {
    async listSessions(studentId, query) {
      const filters = [eq(tutoringSessions.studentId, studentId)];
      if (query.status) filters.push(eq(tutoringSessions.status, query.status));

      return db()
        .select()
        .from(tutoringSessions)
        .where(and(...filters))
        .orderBy(MOST_RECENTLY_ACTIVE_FIRST)
        .limit(query.limit);
    },
  };
}
