"use client";

import { useEffect, useRef, useState } from "react";
import { useAccessibility } from "@/lib/accessibility/AccessibilityProvider";

/**
 * Flexible pacing made concrete (spec §6.8): when the learner keeps breaks on,
 * a calm, non-modal banner offers one after their chosen interval. It never
 * interrupts (role="status", polite), never traps focus, and a dismiss or
 * snooze simply resets the timer — the learner stays in control of pacing.
 */
export function BreakReminder({ className = "" }: { className?: string }) {
  const { prefs } = useAccessibility();
  const [due, setDue] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const intervalMs = prefs.breakIntervalMinutes * 60 * 1000;

  useEffect(() => {
    if (!prefs.allowBreaks) return;
    timerRef.current = setTimeout(() => setDue(true), intervalMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [prefs.allowBreaks, intervalMs]);

  if (!prefs.allowBreaks || !due) return null;

  function reset() {
    setDue(false);
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col gap-3 rounded-2xl border border-line bg-lavender-soft px-4 py-3 text-ink sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <p className="text-base font-semibold">
        You&apos;ve been going for {prefs.breakIntervalMinutes} minutes — time for a short break?
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-primary px-4 py-2 text-sm font-bold text-on-primary transition-colors hover:bg-primary-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Take a break
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-full border border-line bg-card px-4 py-2 text-sm font-bold text-primary transition-colors hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Keep going
        </button>
      </div>
    </div>
  );
}
