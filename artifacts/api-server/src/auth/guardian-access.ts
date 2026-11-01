import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { consents, guardianLinks } from "@workspace/db/schema";
import type { GuardianAccessPort } from "./authorize";

export function drizzleGuardianAccess(db: () => NodePgDatabase): GuardianAccessPort {
  return {
    async hasGrantedGuardianAccess(parentId, studentId) {
      const [link] = await db()
        .select({ id: guardianLinks.id, status: guardianLinks.status })
        .from(guardianLinks)
        .where(and(eq(guardianLinks.parentId, parentId), eq(guardianLinks.studentId, studentId)))
        .limit(1);
      if (!link || link.status !== "granted") return false;

      // The consent trail is the authority: a link flipped to "granted"
      // without a recorded, unrevoked guardian_access consent grants nothing.
      const [consent] = await db()
        .select({ id: consents.id })
        .from(consents)
        .where(
          and(
            eq(consents.guardianLinkId, link.id),
            eq(consents.type, "guardian_access"),
            isNull(consents.revokedAt),
          ),
        )
        .limit(1);
      return consent !== undefined;
    },

    async getGuardianLink(linkId) {
      const [row] = await db()
        .select({
          id: guardianLinks.id,
          parentId: guardianLinks.parentId,
          status: guardianLinks.status,
        })
        .from(guardianLinks)
        .where(eq(guardianLinks.id, linkId))
        .limit(1);
      return row;
    },
  };
}
