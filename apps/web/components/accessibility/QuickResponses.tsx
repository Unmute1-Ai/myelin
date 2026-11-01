"use client";

import { useAccessibility } from "@/lib/accessibility/AccessibilityProvider";

/**
 * AAC-friendly quick responses (spec §6.8). A grid of large, clearly labeled
 * buttons for learners who communicate through set phrases — every target is
 * keyboard-focusable and grows further under `data-aac-input="on"` (the CSS
 * in globals.css). Hidden until the learner opts in; the tutor input and
 * dashboard waves compose it where free-text entry would sit.
 */
const DEFAULT_PHRASES = [
  "I don't understand yet.",
  "Say it a different way.",
  "Show me an example.",
  "I need a break.",
] as const;

export function QuickResponses({
  phrases = DEFAULT_PHRASES,
  onSelect,
  className = "",
}: {
  phrases?: ReadonlyArray<string>;
  onSelect?: (phrase: string) => void;
  className?: string;
}) {
  const { prefs } = useAccessibility();

  if (!prefs.aacInputEnabled) return null;

  return (
    <div
      role="group"
      aria-label="Quick responses"
      className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${className}`}
    >
      {phrases.map((phrase) => (
        <button
          key={phrase}
          type="button"
          className="quick-response-button rounded-2xl border border-line bg-card px-4 py-3 text-left text-base font-bold text-ink transition-colors hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={() => onSelect?.(phrase)}
        >
          {phrase}
        </button>
      ))}
    </div>
  );
}
