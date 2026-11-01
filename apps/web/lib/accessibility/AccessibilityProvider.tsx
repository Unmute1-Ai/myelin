"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_PREFERENCE_FIELDS,
  applyPrefsToDocument,
  mergePrefs,
  withSystemMotion,
  type PreferenceFields,
} from "./prefs";
import {
  PrefsSignedOutError,
  fetchAccessibilityPrefs,
  saveAccessibilityPrefs,
} from "./api";

/**
 * Where the learner's preferences stand. Every state is honest and rendered:
 * - "loading"      → the settings request is in flight
 * - "ready"        → stored prefs loaded, saves persist server-side
 * - "signed-out"   → no session; choices apply locally for this visit only
 * - "unconfigured" → no API origin; platform a11y still applies
 * - "error"        → a real fault; a retry is offered, never a silent fallback
 */
export type AccessibilityStatus =
  | "loading"
  | "ready"
  | "signed-out"
  | "unconfigured"
  | "error";

export interface AccessibilityContextValue {
  status: AccessibilityStatus;
  /** The preference fields currently applied (stored, or local when unsaved). */
  prefs: PreferenceFields;
  /** Persisted now? False while a save is in flight or when applying locally. */
  saved: boolean;
  /** Applies a patch optimistically; persists when the caller has a session. */
  update(patch: Partial<PreferenceFields>): Promise<void>;
  /** Re-loads stored prefs after an error. */
  retry(): void;
  /** Speaks text through the browser's voices when TTS is enabled. */
  speak(text: string): void;
  stopSpeaking(): void;
  /** The most recent text spoken — the caption region renders it. */
  captionText: string | null;
}

const AccessibilityContext = createContext<AccessibilityContextValue | null>(null);

function systemReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AccessibilityStatus>("loading");
  const [prefs, setPrefs] = useState<PreferenceFields>(DEFAULT_PREFERENCE_FIELDS);
  const [saved, setSaved] = useState(false);
  const [captionText, setCaptionText] = useState<string | null>(null);
  const [loadTick, setLoadTick] = useState(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Load the signed-in learner's stored settings once, and again on retry.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const stored = await fetchAccessibilityPrefs();
        if (cancelled || !aliveRef.current) return;
        setPrefs(withSystemMotion(stored, systemReducedMotion()));
        setSaved(true);
        setStatus("ready");
      } catch (error) {
        if (cancelled || !aliveRef.current) return;
        if (error instanceof PrefsSignedOutError) {
          setPrefs(withSystemMotion(DEFAULT_PREFERENCE_FIELDS, systemReducedMotion()));
          setSaved(false);
          setStatus("signed-out");
          return;
        }
        // A missing API origin is a configuration state, not a fault to spam
        // the learner with — but it still gets its own honest status.
        if (error instanceof Error && error.message.includes("not configured")) {
          setPrefs(withSystemMotion(DEFAULT_PREFERENCE_FIELDS, systemReducedMotion()));
          setSaved(false);
          setStatus("unconfigured");
          return;
        }
        setSaved(false);
        setStatus("error");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [loadTick]);

  // The app-wide application: document attributes the CSS keys on.
  useEffect(() => {
    applyPrefsToDocument(prefs, document.documentElement);
  }, [prefs]);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const speak = useCallback(
    (text: string) => {
      // Captions record what was asked to speak regardless of the TTS toggle;
      // the caption region decides visibility by the captions preference.
      setCaptionText(text);
      if (prefs.ttsEnabled && typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
      }
    },
    [prefs.ttsEnabled],
  );

  const update = useCallback(
    async (patch: Partial<PreferenceFields>) => {
      const previous = prefs;
      setPrefs(withSystemMotion(mergePrefs(previous, patch), systemReducedMotion()));
      if (status !== "ready") {
        // No session (or none configured): apply for this visit, say so.
        setSaved(false);
        return;
      }
      setSaved(false);
      try {
        const stored = await saveAccessibilityPrefs(patch);
        if (!aliveRef.current) return;
        setPrefs(withSystemMotion(stored, systemReducedMotion()));
        setSaved(true);
      } catch {
        if (!aliveRef.current) return;
        // The optimistic apply failed to persist — fall back to what the
        // server had, and surface the failure instead of swallowing it.
        setPrefs(withSystemMotion(previous, systemReducedMotion()));
        setSaved(true);
        throw new Error("Your change could not be saved just now — try again.");
      }
    },
    [prefs, status],
  );

  const retry = useCallback(() => setLoadTick((n) => n + 1), []);

  const value = useMemo<AccessibilityContextValue>(
    () => ({ status, prefs, saved, update, retry, speak, stopSpeaking, captionText }),
    [status, prefs, saved, update, retry, speak, stopSpeaking, captionText],
  );

  return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>;
}

export function useAccessibility(): AccessibilityContextValue {
  const context = useContext(AccessibilityContext);
  if (!context) {
    throw new Error("useAccessibility must be used inside <AccessibilityProvider>.");
  }
  return context;
}
