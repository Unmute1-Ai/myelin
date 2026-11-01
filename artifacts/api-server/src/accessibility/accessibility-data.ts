import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { accessibilityPrefs, type AccessibilityPrefs } from "@workspace/db/schema";

/**
 * The accessibility-prefs data port (spec §6.8). One row per user, keyed to
 * the caller — there is no path to another user's settings because no method
 * accepts a subject other than the owner the route already authenticated.
 */
export interface AccessibilityDataPort {
  /** Returns the caller's row, lazily creating product defaults on first touch. */
  ensurePrefs(userId: string): Promise<AccessibilityPrefs>;
  /** Applies a validated partial patch to the caller's row and returns it. */
  updatePrefs(
    userId: string,
    patch: Partial<Omit<AccessibilityPrefs, "id" | "userId" | "createdAt" | "updatedAt">>,
  ): Promise<AccessibilityPrefs>;
}

/** Product defaults for the Deaf/HoH-first audience — mirrors the schema's column defaults. */
export function defaultAccessibilityPrefs(userId: string): AccessibilityPrefs {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    userId,
    ttsEnabled: false,
    captionsEnabled: true,
    highContrast: false,
    textSize: "medium",
    reducedMotion: false,
    aacInputEnabled: false,
    allowBreaks: true,
    breakIntervalMinutes: 20,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** Drizzle-backed port. The unique constraint on user_id backs the lazy create. */
export function drizzleAccessibilityData(db: () => NodePgDatabase): AccessibilityDataPort {
  return {
    async ensurePrefs(userId) {
      await db().insert(accessibilityPrefs).values({ userId }).onConflictDoNothing();
      const [row] = await db()
        .select()
        .from(accessibilityPrefs)
        .where(eq(accessibilityPrefs.userId, userId))
        .limit(1);
      // The insert above guarantees the row exists (unique user_id); an empty
      // read here would mean a concurrent delete — surface it, never guess.
      if (!row) throw new Error("accessibility_prefs row missing after ensure");
      return row;
    },

    async updatePrefs(userId, patch) {
      // Guarantee the row first so a first-touch PUT cannot update zero rows.
      await this.ensurePrefs(userId);
      const [row] = await db()
        .update(accessibilityPrefs)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(accessibilityPrefs.userId, userId))
        .returning();
      if (!row) throw new Error("accessibility_prefs row missing after update");
      return row;
    },
  };
}
