import { useCallback, useEffect, useState } from "react";

/**
 * Web Speech output for Primer: speaks the tutor's short spoken line while
 * the full detail stays on screen. Speech is output only — nothing in the
 * MVP listens back, so spoken assent can never authorize anything.
 */
export function useSpeech(): {
  speak: (text: string) => void;
  cancel: () => void;
  supported: boolean;
  speaking: boolean;
} {
  const [speaking, setSpeaking] = useState(false);
  // Read once — the presence of speechSynthesis is stable per browser.
  const [supported] = useState(
    () => typeof window !== "undefined" && "speechSynthesis" in window,
  );

  const cancel = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported || text.trim() === "") return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    },
    [supported],
  );

  // A route change must not leave a voice talking.
  useEffect(() => cancel, [cancel]);

  return { speak, cancel, supported, speaking };
}
