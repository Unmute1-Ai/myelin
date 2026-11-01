import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { textSize } from "./enums";
import { users } from "./users";

/**
 * Per-user accessibility settings (spec §6.8), applied app-wide. Defaults are
 * product choices for the Deaf/HoH-first audience: captions on, TTS off.
 * Keyboard navigation and screen-reader labels are always-on platform
 * behavior, not preferences, so they have no column here. No diagnosis gate
 * exists — any user sets any preference.
 */
export const accessibilityPrefs = pgTable(
  "accessibility_prefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    ttsEnabled: boolean("tts_enabled").notNull().default(false),
    captionsEnabled: boolean("captions_enabled").notNull().default(true),
    highContrast: boolean("high_contrast").notNull().default(false),
    textSize: textSize("text_size").notNull().default("medium"),
    reducedMotion: boolean("reduced_motion").notNull().default(false),
    aacInputEnabled: boolean("aac_input_enabled").notNull().default(false),
    allowBreaks: boolean("allow_breaks").notNull().default(true),
    breakIntervalMinutes: integer("break_interval_minutes").notNull().default(20),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "accessibility_break_interval_range",
      sql`${t.breakIntervalMinutes} BETWEEN 1 AND 240`,
    ),
  ],
);

export const accessibilityPrefsRelations = relations(accessibilityPrefs, ({ one }) => ({
  user: one(users, {
    fields: [accessibilityPrefs.userId],
    references: [users.id],
  }),
}));

export type AccessibilityPrefs = typeof accessibilityPrefs.$inferSelect;
export type InsertAccessibilityPrefs = z.infer<typeof insertAccessibilityPrefsSchema>;
export const insertAccessibilityPrefsSchema = createInsertSchema(accessibilityPrefs);
