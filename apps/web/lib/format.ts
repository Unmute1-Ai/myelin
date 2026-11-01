/** Presentation formatters — pure, locale-stable (UTC), trivially testable. */

const day = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const dayAndTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

/** "Nov 1" — for dates where the day is the grain that matters. */
export function formatDay(date: Date): string {
  return day.format(date);
}

/** "Nov 1, 3:45 PM" — for timeline rows and session stamps. */
export function formatDayTime(date: Date): string {
  return dayAndTime.format(date);
}

/** Friendly rung names for the mastery ladder (spec §6.3 vocabulary). */
export const MASTERY_RUNG_LABELS: Record<string, string> = {
  memorization: "Remembered",
  recognition: "Recognized",
  comprehension: "Understood",
  application: "Applied",
  mastery: "Mastered",
};

/** "strategy_changed" → "Strategy changed" — event kinds as readable labels. */
export function humanizeKind(kind: string): string {
  return kind.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
}
