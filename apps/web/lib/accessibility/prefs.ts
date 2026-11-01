import { z } from "zod";
import { GetAccessibilityPrefsResponse } from "@workspace/api-zod";

/*
 * Client-side accessibility model (spec §6.8). The contract schema is the
 * source of truth: this module derives the runtime type from it and adds the
 * pure helpers the provider and components compose — never a second
 * hand-written shape that could drift from the API.
 */

/** Full prefs row as served by GET /me/accessibility. */
export type AccessibilityPrefs = z.infer<typeof GetAccessibilityPrefsResponse>;

/** The preference fields only — what signed-out visitors tune before any row exists. */
export type PreferenceFields = Pick<
  AccessibilityPrefs,
  | "ttsEnabled"
  | "captionsEnabled"
  | "highContrast"
  | "textSize"
  | "reducedMotion"
  | "aacInputEnabled"
  | "allowBreaks"
  | "breakIntervalMinutes"
>;

/**
 * Product defaults for the Deaf/HoH-first audience — mirrors the DB column
 * defaults in lib/db/src/schema/accessibility.ts. Captions default on, TTS
 * off: meaning arrives visually first, speech is an opt-in.
 */
export const DEFAULT_PREFERENCE_FIELDS: PreferenceFields = {
  ttsEnabled: false,
  captionsEnabled: true,
  highContrast: false,
  textSize: "medium",
  reducedMotion: false,
  aacInputEnabled: false,
  allowBreaks: true,
  breakIntervalMinutes: 20,
};

export type TextSize = PreferenceFields["textSize"];

export const TEXT_SIZES: ReadonlyArray<{ value: TextSize; label: string }> = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium (default)" },
  { value: "large", label: "Large" },
  { value: "xlarge", label: "Extra large" },
];

/**
 * The effective preference set the app renders: the user's explicit choices,
 * with reduced motion OR-ed with the operating system's setting — a learner
 * whose device already asks for calm gets calm even before their row loads.
 */
export function withSystemMotion(
  prefs: PreferenceFields,
  systemReducedMotion: boolean,
): PreferenceFields {
  return {
    ...prefs,
    reducedMotion: prefs.reducedMotion || systemReducedMotion,
  };
}

/**
 * Pure mapping from preferences to the document attributes the app-wide CSS
 * keys on (globals.css). Returns only attributes it actually sets so the
 * applier stays declarative and testable.
 */
export function prefsToDocumentAttributes(prefs: PreferenceFields): Record<string, string> {
  return {
    "data-text-size": prefs.textSize,
    "data-contrast": prefs.highContrast ? "high" : "normal",
    "data-motion": prefs.reducedMotion ? "reduced" : "full",
    "data-aac-input": prefs.aacInputEnabled ? "on" : "off",
    "data-breaks": prefs.allowBreaks ? "on" : "off",
  };
}

/** Applies the attribute map to an element (documentElement in the browser). */
export function applyPrefsToDocument(
  prefs: PreferenceFields,
  doc: { setAttribute(name: string, value: string): void },
): void {
  for (const [name, value] of Object.entries(prefsToDocumentAttributes(prefs))) {
    doc.setAttribute(name, value);
  }
}

/** Merge a partial patch over the current fields — the optimistic-update shape. */
export function mergePrefs(
  current: PreferenceFields,
  patch: Partial<PreferenceFields>,
): PreferenceFields {
  return { ...current, ...patch };
}
