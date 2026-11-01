/*
 * Card 10 — Accessibility settings (spec §6.8): the learner's stored
 * preferences, editable and saved through the API the page passes in.
 * The page applies them app-wide (document-root attributes + text size);
 * keyboard navigation and screen-reader labels are always-on platform
 * behavior, so they are not preferences here (contract doc). No diagnosis
 * gate — any learner sets any preference.
 */
import { useId } from "react";
import { Card } from "@/components/ui";
import type { AccessibilityPrefs } from "@workspace/api-zod";

const TEXT_SIZES = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "xlarge", label: "Extra large" },
] as const;

export interface AccessibilityToggle {
  key: "ttsEnabled" | "captionsEnabled" | "highContrast" | "reducedMotion" | "aacInputEnabled" | "allowBreaks";
  label: string;
  hint: string;
}

const TOGGLES: AccessibilityToggle[] = [
  { key: "ttsEnabled", label: "Read aloud", hint: "Text-to-speech reads problems and hints out loud." },
  { key: "captionsEnabled", label: "Captions", hint: "Show written text for anything spoken." },
  { key: "highContrast", label: "High contrast", hint: "Stronger colors that are easier to see." },
  { key: "reducedMotion", label: "Reduce motion", hint: "Calm animations and transitions." },
  { key: "aacInputEnabled", label: "AAC-friendly input", hint: "Quick word buttons for building answers." },
  { key: "allowBreaks", label: "Break reminders", hint: "Gentle reminders to rest between topics." },
];

export function AccessibilitySettingsCard({
  prefs,
  saving,
  savingError,
  onToggle,
  onTextSize,
  onBreakInterval,
}: {
  prefs: AccessibilityPrefs;
  saving: boolean;
  savingError: string | null;
  onToggle: (key: AccessibilityToggle["key"], value: boolean) => void;
  onTextSize: (size: AccessibilityPrefs["textSize"]) => void;
  onBreakInterval: (minutes: number) => void;
}) {
  const uid = useId();

  return (
    <Card className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-extrabold text-ink">Accessibility</h2>
        <p className="text-sm text-ink-soft">
          Make PRIMER work for you. These settings apply everywhere in the app and are saved to
          your account.
        </p>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-bold text-ink">Display and interaction</legend>
        {TOGGLES.map((toggle) => {
          const toggleId = `${uid}-${toggle.key}`;
          return (
            <div key={toggle.key} className="flex items-start justify-between gap-4">
              <div className="flex flex-col">
                <label htmlFor={toggleId} className="text-sm font-bold text-ink">
                  {toggle.label}
                </label>
                <p className="text-xs text-ink-soft">{toggle.hint}</p>
              </div>
              <button
                type="button"
                id={toggleId}
                role="switch"
                aria-checked={prefs[toggle.key]}
                disabled={saving}
                onClick={() => onToggle(toggle.key, !prefs[toggle.key])}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                  prefs[toggle.key] ? "bg-primary" : "bg-lavender"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute top-1 h-5 w-5 rounded-full bg-card shadow transition-all ${
                    prefs[toggle.key] ? "left-6" : "left-1"
                  }`}
                />
                <span className="sr-only">
                  {prefs[toggle.key] ? "On" : "Off"} — {toggle.label}
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
                onClick={() => onTextSize(size.value)}
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
              onChange={(e) => onBreakInterval(Number(e.target.value))}
              className="h-2 w-full accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-valuetext={`${prefs.breakIntervalMinutes} minutes`}
            />
            <span className="w-20 text-sm font-bold text-ink">{prefs.breakIntervalMinutes} min</span>
          </div>
        </div>
      ) : null}

      {savingError ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {savingError}
        </p>
      ) : null}
    </Card>
  );
}
