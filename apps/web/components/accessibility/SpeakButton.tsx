"use client";

import { useState, type ComponentProps } from "react";
import { useAccessibility } from "@/lib/accessibility/AccessibilityProvider";

type SpeakButtonProps = Omit<ComponentProps<"button">, "onClick" | "children"> & { text: string };

/**
 * "Read aloud" control for a block of content (spec §6.8 TTS). Renders only
 * when the learner turned TTS on — speech is an opt-in, never ambient. While
 * speaking, the button becomes "Stop reading" (an honest pressed state).
 */
export function SpeakButton({ text, className = "", ...props }: SpeakButtonProps) {
  const { prefs, speak, stopSpeaking } = useAccessibility();
  const [speaking, setSpeaking] = useState(false);

  if (!prefs.ttsEnabled) return null;

  return (
    <button
      {...props}
      type="button"
      aria-pressed={speaking}
      onClick={() => {
        if (speaking) {
          stopSpeaking();
          setSpeaking(false);
        } else {
          speak(text);
          setSpeaking(true);
        }
      }}
      className={`inline-flex items-center gap-2 rounded-full border border-line bg-card px-4 py-2 text-sm font-bold text-primary transition-colors hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${className}`}
    >
      {speaking ? "Stop reading" : "Read aloud"}
    </button>
  );
}
