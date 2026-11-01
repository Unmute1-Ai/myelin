// Drizzle backing for the educator data port (see educator-service.ts). Joins
// resolve student identity for display; the routes have already authorized
// every call by the time these run.
import { and, count, desc, eq, inArray, isNull, max } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  assessments,
  educatorAssignments,
  educatorLinks,
  educatorSupports,
  learningProfiles,
  profileEntries,
  progressEvents,
  users,
  type EducatorLink,
} from "@workspace/db/schema";
import type {
  ClassSummaryFact,
  EducatorDataPort,
  EducatorLinkRow,
  NewAssignment,
  SupportsUpdate,
} from "./educator-service";

export function drizzleEducatorData(db: () => NodePgDatabase): EducatorDataPort {
  /** Joins a bare link row with the student account for the response view. */
  async function withStudent(link: EducatorLink): Promise<EducatorLinkRow> {
    const [student] = await db()
      .select({ email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, link.studentId))
      .limit(1);
    return { ...link, studentEmail: student?.email ?? "", studentDisplayName: student?.displayName ?? "" };
  }

  return {
    // Same existence semantics as the profile and progress routes: the user
    // must exist and hold the student role (an educator id in the path is a
    // 404, not a leak).
    async studentExists(studentId) {
      const [row] = await db()
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, studentId), eq(users.role, "student")))
        .limit(1);
      return row !== undefined;
    },

    async studentIdByEmail(email) {
      const [row] = await db()
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, email), eq(users.role, "student")))
        .limit(1);
      return row?.id;
    },

    async listLinks(educatorId) {
      const base = db()
        .select({
          link: educatorLinks,
          studentEmail: users.email,
          studentDisplayName: users.displayName,
        })
        .from(educatorLinks)
        .innerJoin(users, eq(users.id, educatorLinks.studentId));

      const rows =
        educatorId === undefined
          ? await base
          : await base.where(eq(educatorLinks.educatorId, educatorId));

      return rows.map(({ link, studentEmail, studentDisplayName }) => ({
        ...link,
        studentEmail,
        studentDisplayName,
      }));
    },

    async findLinkByPair(educatorId, studentId) {
      const [row] = await db()
        .select({
          link: educatorLinks,
          studentEmail: users.email,
          studentDisplayName: users.displayName,
        })
        .from(educatorLinks)
        .innerJoin(users, eq(users.id, educatorLinks.studentId))
        .where(and(eq(educatorLinks.educatorId, educatorId), eq(educatorLinks.studentId, studentId)))
        .limit(1);
      return row === undefined
        ? undefined
        : { ...row.link, studentEmail: row.studentEmail, studentDisplayName: row.studentDisplayName };
    },

    async createLink(educatorId, studentId) {
      const [link] = await db().insert(educatorLinks).values({ educatorId, studentId }).returning();
      return withStudent(link);
    },

    async setLinkStatus(linkId, status) {
      const [link] = await db()
        .update(educatorLinks)
        .set({ status, updatedAt: new Date() })
        .where(eq(educatorLinks.id, linkId))
        .returning();
      return withStudent(link);
    },

    async listAssignments(educatorId) {
      return db()
        .select()
        .from(educatorAssignments)
        .where(eq(educatorAssignments.educatorId, educatorId))
        .orderBy(desc(educatorAssignments.createdAt));
    },

    async createAssignment(input: NewAssignment) {
      const [assignment] = await db().insert(educatorAssignments).values(input).returning();
      return assignment;
    },

    async getSupports(studentId) {
      const [row] = await db()
        .select()
        .from(educatorSupports)
        .where(eq(educatorSupports.studentId, studentId))
        .limit(1);
      return row;
    },

    async upsertSupports(studentId, update: SupportsUpdate, updatedBy) {
      const [row] = await db()
        .insert(educatorSupports)
        .values({ studentId, supports: update.supports, notes: update.notes, updatedBy })
        .onConflictDoUpdate({
          target: educatorSupports.studentId,
          set: { supports: update.supports, notes: update.notes, updatedBy, updatedAt: new Date() },
        })
        .returning();
      return row;
    },

    // The rollup runs as three grouped aggregates over the pre-authorized ids:
    // live gap entries via the entry→profile join, live assessments per level,
    // and the last progress event per student.
    async listClassSummaries(studentIds) {
      const emptyCounts = {
        memorization: 0,
        recognition: 0,
        comprehension: 0,
        application: 0,
        mastery: 0,
      };
      if (studentIds.length === 0) return [];

      const [gapRows, levelRows, activityRows, studentRows] = await Promise.all([
        db()
          .select({ studentId: learningProfiles.studentId, gapCount: count() })
          .from(profileEntries)
          .innerJoin(learningProfiles, eq(profileEntries.profileId, learningProfiles.id))
          .where(
            and(
              inArray(learningProfiles.studentId, studentIds),
              eq(profileEntries.kind, "gap"),
              isNull(profileEntries.invalidatedAt),
            ),
          )
          .groupBy(learningProfiles.studentId),
        db()
          .select({
            studentId: assessments.studentId,
            level: assessments.level,
            levelCount: count(),
          })
          .from(assessments)
          .where(and(inArray(assessments.studentId, studentIds), isNull(assessments.revokedAt)))
          .groupBy(assessments.studentId, assessments.level),
        db()
          .select({ studentId: progressEvents.studentId, lastActiveAt: max(progressEvents.createdAt) })
          .from(progressEvents)
          .where(inArray(progressEvents.studentId, studentIds))
          .groupBy(progressEvents.studentId),
        db()
          .select({ id: users.id, displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, studentIds)),
      ]);

      const gapsByStudent = new Map(gapRows.map((r) => [r.studentId, Number(r.gapCount)]));
      const activityByStudent = new Map(
        activityRows.map((r) => [r.studentId, r.lastActiveAt === null ? null : new Date(r.lastActiveAt)]),
      );
      const countsByStudent = new Map<string, ClassSummaryFact["masteryCounts"]>();
      for (const row of levelRows) {
        const counts = countsByStudent.get(row.studentId) ?? { ...emptyCounts };
        counts[row.level] = Number(row.levelCount);
        countsByStudent.set(row.studentId, counts);
      }

      return studentRows.map(({ id, displayName }): ClassSummaryFact => ({
        studentId: id,
        displayName,
        gapCount: gapsByStudent.get(id) ?? 0,
        masteryCounts: countsByStudent.get(id) ?? { ...emptyCounts },
        lastActiveAt: activityByStudent.get(id) ?? null,
      }));
    },
  };
}
