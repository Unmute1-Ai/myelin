import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { educatorLinks } from "@workspace/db/schema";
import type { EducatorAccessPort } from "./authorize";

/**
 * The educator side of the authorization boundary: access is exactly a live
 * admin-granted link. Pending and revoked links grant nothing — unlike the
 * guardian trail there is no separate consent row; the recorded grant itself
 * (an admin's status flip, audited) is the human authorization decision.
 */
export function drizzleEducatorAccess(db: () => NodePgDatabase): EducatorAccessPort {
  return {
    async hasActiveEducatorLink(educatorId, studentId) {
      const [link] = await db()
        .select({ id: educatorLinks.id })
        .from(educatorLinks)
        .where(
          and(
            eq(educatorLinks.educatorId, educatorId),
            eq(educatorLinks.studentId, studentId),
            eq(educatorLinks.status, "granted"),
          ),
        )
        .limit(1);
      return link !== undefined;
    },

    async getEducatorLink(linkId) {
      const [row] = await db()
        .select({
          id: educatorLinks.id,
          educatorId: educatorLinks.educatorId,
          status: educatorLinks.status,
        })
        .from(educatorLinks)
        .where(eq(educatorLinks.id, linkId))
        .limit(1);
      return row;
    },
  };
}
