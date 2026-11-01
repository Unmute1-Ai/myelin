import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { accessibilityPrefs, type AccessibilityPrefs } from "@workspace/db/schema";

/**
 * Per-user accessibility preferences (spec §6.8). The route only ever touches
 * the caller's own row — there is no path parameter to misread — and the
 * policy layer still records the decision (any user may set any preference;
 * no diagnosis gate exists).
 */

/** The partial-update shape, already validated against the contract. */
export type AccessibilityPrefsPatch = Partial<
  Pick<
    AccessibilityPrefs,
    | "ttsEnabled"
    | "captionsEnabled"
    | "highContrast"
    | "textSize"
    | "reducedMotion"
    | "aacInputEnabled"
    | "allowBreaks"
    | "breakIntervalMinutes"
  >
>;

export interface AccessibilityDataPort {
  /** Find-or-create the caller's prefs row — a new account is never dead. */
  ensurePrefs(userId: string): Promise<AccessibilityPrefs>;
  /** Apply a validated partial update; returns the fresh row. */
  updatePrefs(userId: string, patch: AccessibilityPrefsPatch): Promise<AccessibilityPrefs>;
}

export function drizzleAccessibilityData(db: () => NodePgDatabase): AccessibilityDataPort {
  return {
    async ensurePrefs(userId) {
      const [existing] = await db()
        .select()
        .from(accessibilityPrefs)
        .where(eq(accessibilityPrefs.userId, userId))
        .limit(1);
      if (existing) return existing;

      // onConflictDoNothing: a concurrent ensure for the same user must not
      // throw on the unique constraint — the winner's row is simply re-read.
      const [created] = await db()
        .insert(accessibilityPrefs)
        .values({ userId })
        .onConflictDoNothing()
        .returning();
      if (created) return created;

      const [raced] = await db()
        .select()
        .from(accessibilityPrefs)
        .where(eq(accessibilityPrefs.userId, userId))
        .limit(1);
      if (!raced) throw new Error("accessibility prefs row vanished during ensure");
      return raced;
    },

    async updatePrefs(userId, patch) {
      const current = await this.ensurePrefs(userId);
      const [updated] = await db()
        .update(accessibilityPrefs)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(accessibilityPrefs.userId, userId))
        .returning();
      if (!updated) return current;
      return updated;
    },
  };
}
