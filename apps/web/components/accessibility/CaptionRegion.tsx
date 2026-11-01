"use client";

import { useAccessibility } from "@/lib/accessibility/AccessibilityProvider";

/**
 * Visible captions for spoken output (spec §6.8 captions). Any text the app
 * speaks lands here as a polite live region, so a learner who turns both TTS
 * and captions on gets every spoken word captioned on screen.
 */
export function CaptionRegion({ className = "" }: { className?: string }) {
  const { prefs, captionText } = useAccessibility();

  if (!prefs.captionsEnabled || !captionText) return null;

  return (
    <p
      role="status"
      aria-live="polite"
      className={`rounded-2xl border border-line bg-mascot-soft px-4 py-3 text-base font-semibold text-ink ${className}`}
    >
      {captionText}
    </p>
  );
}
