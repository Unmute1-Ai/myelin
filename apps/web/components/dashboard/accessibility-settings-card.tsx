/*
 * Card 10 — Accessibility settings (spec §6.8): quick controls over the
 * learner's stored preferences, consumed straight from the app-wide
 * AccessibilityProvider (PR #13's canonical system — same context, PUT
 * contract, and defaults as the full /accessibility settings page).
 * Keyboard navigation and screen-reader labels are always-on platform
 * behavior, so they are not preferences here (contract doc). No diagnosis
 * gate — any learner sets any preference.
 */
import { useId, useState } from "react";
import { Button, Card } from "@/components/ui";
import {
  useAccessibility,
  type AccessibilityStatus,
} from "@/lib/accessibility/AccessibilityProvider";
import { TEXT_SIZES, type PreferenceFields } from "@/lib/accessibility/prefs";

type ToggleKey = Extract<
  keyof PreferenceFields,
  "ttsEnabled" | "captionsEnabled" | "highContrast" | "reducedMotion" | "aacInputEnabled" | "allowBreaks"
>;

const TOGGLES: { key: ToggleKey; label: string; hint: string }[] = [
  { key: "ttsEnabled", label: "Read aloud", hint: "Text-to-speech reads problems and hints out loud." },
  { key: "captionsEnabled", label: "Captions", hint: "Show written text for anything spoken." },
  { key: "highContrast", label: "High contrast", hint: "Stronger colors that are easier to see." },
  { key: "reducedMotion", label: "Reduce motion", hint: "Calm animations and transitions." },
  { key: "aacInputEnabled", label: "AAC-friendly input", hint: "Quick word buttons for building answers." },
  { key: "allowBreaks", label: "Break reminders", hint: "Gentle reminders to rest between topics." },
];

const STATUS_TEXT: Record<Exclude<AccessibilityStatus, "ready" | "error">, string> = {
  loading: "Loading your accessibility settings…",
  "signed-out": "Sign in to save accessibility settings for your account.",
  unconfigured: "The accessibility service is not configured right now.",
};

export function AccessibilitySettingsCard() {
  const uid = useId();
  const { status, prefs, saved, update, retry } = useAccessibility();
  const [saveError, setSaveError] = useState<string | null>(null);
  const saving = !saved;

  if (status === "error") {
    return (
      <Card className="flex flex-col items-start gap-3">
        <h2 className="text-xl font-extrabold text-ink">Accessibility</h2>
        <p role="alert" className="text-sm text-ink-soft">
          Your accessibility settings could not be loaded.
        </p>
        <Button variant="secondary" type="button" onClick={retry}>
          Try again
        </Button>
      </Card>
    );
  }

  if (status !== "ready") {
    return (
      <Card className="flex flex-col gap-3">
        <h2 className="text-xl font-extrabold text-ink">Accessibility</h2>
        <p role="status" className="text-sm text-ink-soft">
          {STATUS_TEXT[status]}
        </p>
      </Card>
    );
  }

  function toggle(key: ToggleKey, value: boolean) {
    setSaveError(null);
    update({ [key]: value }).catch((error: Error) => setSaveError(error.message));
  }
  function setTextSize(size: PreferenceFields["textSize"]) {
    setSaveError(null);
    update({ textSize: size }).catch((error: Error) => setSaveError(error.message));
  }
  function setBreakInterval(minutes: number) {
    setSaveError(null);
    update({ breakIntervalMinutes: minutes }).catch((error: Error) => setSaveError(error.message));
  }

  return (
    <Card className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-extrabold text-ink">Accessibility</h2>
        <p className="text-sm text-ink-soft">
          Make PRIMER work for you. These settings apply everywhere in the app and are saved to
          your account.{" "}
          <a href="/accessibility" className="font-bold text-primary underline">
            All accessibility settings
          </a>
        </p>
        <p className="text-sm font-semibold text-ink-soft" role="status" aria-live="polite">
          {saveError ?? (saving ? "Saving…" : "All saved.")}
        </p>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-bold text-ink">Display and interaction</legend>
        {TOGGLES.map((toggleDef) => {
          const toggleId = `${uid}-${toggleDef.key}`;
          return (
            <div key={toggleDef.key} className="flex items-start justify-between gap-4">
              <div className="flex flex-col">
                <label htmlFor={toggleId} className="text-sm font-bold text-ink">
                  {toggleDef.label}
                </label>
                <p className="text-xs text-ink-soft">{toggleDef.hint}</p>
              </div>
              <button
                type="button"
                id={toggleId}
                role="switch"
                aria-checked={prefs[toggleDef.key]}
                disabled={saving}
                onClick={() => toggle(toggleDef.key, !prefs[toggleDef.key])}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                  prefs[toggleDef.key] ? "bg-primary" : "bg-lavender"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute top-1 h-5 w-5 rounded-full bg-card shadow transition-all ${
                    prefs[toggleDef.key] ? "left-6" : "left-1"
                  }`}
                />
                <span className="sr-only">
                  {prefs[toggleDef.key] ? "On" : "Off"} — {toggleDef.label}
                </span>
              </button>
            </div>
          );
        })}
      </fieldset>

      <div className="flex flex-col gap-2">
        <fieldset>
          <legend className="text-sm font-bold text-ink">Text size</legend>
          <div role="radiogroup" aria-label="Text size" className="mt-2 flex flex-wrap gap-2">
            {TEXT_SIZES.map((size) => (
              <button
                key={size.value}
                type="button"
                role="radio"
                aria-checked={prefs.textSize === size.value}
                disabled={saving}
                onClick={() => setTextSize(size.value)}
                className={`rounded-full px-4 py-2 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                  prefs.textSize === size.value
                    ? "bg-primary text-on-primary"
                    : "bg-lavender text-primary hover:bg-primary-soft"
                }`}
              >
                {size.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      {prefs.allowBreaks ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-breaks`} className="text-sm font-bold text-ink">
            Break reminder every
          </label>
          <div className="flex items-center gap-3">
            <input
              id={`${uid}-breaks`}
              type="range"
              min={5}
              max={60}
              step={5}
              value={prefs.breakIntervalMinutes}
              disabled={saving}
              onChange={(e) => setBreakInterval(Number(e.target.value))}
              className="h-2 w-full accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-valuetext={`${prefs.breakIntervalMinutes} minutes`}
            />
            <span className="w-20 text-sm font-bold text-ink">{prefs.breakIntervalMinutes} min</span>
          </div>
        </div>
      ) : null}

      {saveError ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {saveError}
        </p>
      ) : null}
    </Card>
  );
}
