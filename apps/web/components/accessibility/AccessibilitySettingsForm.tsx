"use client";

import { useState } from "react";
import { TEXT_SIZES, type PreferenceFields, type TextSize } from "@/lib/accessibility/prefs";
import { useAccessibility } from "@/lib/accessibility/AccessibilityProvider";
import { Button } from "@/components/ui";

/*
 * The accessibility settings form (spec §6.8). Autosaves each change when the
 * learner has a session; signed-out visitors get the same controls applied
 * for this visit, with an honest notice that nothing is stored. Every control
 * is a native input with a real label — no div-buttons, no placeholder-only
 * labels.
 */

function Toggle({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={id} className="text-base font-bold text-ink">
          {label}
        </label>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="h-6 w-6 shrink-0 accent-[var(--color-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
      </div>
      <p className="text-sm text-ink-soft">{hint}</p>
    </div>
  );
}

export function AccessibilitySettingsForm() {
  const { status, prefs, saved, update, retry } = useAccessibility();
  const [saveError, setSaveError] = useState<string | null>(null);

  const loading = status === "loading";
  const persistence =
    status === "ready"
      ? "Changes save to your account automatically."
      : status === "signed-out"
        ? "You're not signed in — choices apply now, for this visit only."
        : status === "unconfigured"
          ? "The tutoring service isn't connected from this preview — choices apply now, for this visit only."
          : "Loading your settings…";

  function patch(next: Partial<PreferenceFields>) {
    setSaveError(null);
    update(next).catch((error: Error) => setSaveError(error.message));
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-start gap-4 rounded-2xl border border-line bg-card px-5 py-6">
        <p className="text-base font-semibold text-ink" role="alert">
          We couldn&apos;t load your accessibility settings.
        </p>
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-line bg-card px-5 py-6">
      <p className="text-sm font-semibold text-ink-soft" role="status" aria-live="polite">
        {saveError ?? (loading ? persistence : saved ? `${persistence} All saved.` : persistence)}
      </p>

      {saveError ? (
        <p role="alert" className="rounded-2xl bg-mascot-soft px-4 py-3 text-sm font-bold text-ink">
          Your last change is shown as it was before the failed save.
        </p>
      ) : null}

      <fieldset disabled={loading} className="flex flex-col gap-6 disabled:opacity-60">
        <legend className="sr-only">Accessibility preferences</legend>

        <Toggle
          id="pref-tts"
          label="Read text aloud (text-to-speech)"
          hint="Adds a “Read aloud” control to lessons and speaks tutor messages."
          checked={prefs.ttsEnabled}
          onChange={(ttsEnabled) => patch({ ttsEnabled })}
        />

        <Toggle
          id="pref-captions"
          label="Show captions"
          hint="Every spoken word is also shown on screen."
          checked={prefs.captionsEnabled}
          onChange={(captionsEnabled) => patch({ captionsEnabled })}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-base font-bold text-ink">Text size</legend>
          <div className="flex flex-wrap gap-4">
            {TEXT_SIZES.map(({ value, label }) => (
              <label key={value} className="flex items-center gap-2 text-base text-ink">
                <input
                  type="radio"
                  name="text-size"
                  value={value}
                  checked={prefs.textSize === value}
                  onChange={() => patch({ textSize: value as TextSize })}
                  className="h-5 w-5 accent-[var(--color-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <Toggle
          id="pref-contrast"
          label="High contrast"
          hint="Stronger text and borders on every screen."
          checked={prefs.highContrast}
          onChange={(highContrast) => patch({ highContrast })}
        />

        <Toggle
          id="pref-motion"
          label="Reduce motion"
          hint="Calms animation across the app. Your device's own reduce-motion setting is always respected too."
          checked={prefs.reducedMotion}
          onChange={(reducedMotion) => patch({ reducedMotion })}
        />

        <Toggle
          id="pref-aac"
          label="AAC-friendly quick responses"
          hint="Large, labeled buttons for answering without typing."
          checked={prefs.aacInputEnabled}
          onChange={(aacInputEnabled) => patch({ aacInputEnabled })}
        />

        <Toggle
          id="pref-breaks"
          label="Offer breaks while I learn"
          hint="A gentle reminder after your chosen interval — you decide, nothing pauses on its own."
          checked={prefs.allowBreaks}
          onChange={(allowBreaks) => patch({ allowBreaks })}
        />

        <div className="flex flex-col gap-1">
          <label htmlFor="pref-break-interval" className="text-base font-bold text-ink">
            Break reminder interval (minutes)
          </label>
          <input
            id="pref-break-interval"
            type="number"
            min={1}
            max={240}
            value={prefs.breakIntervalMinutes}
            disabled={!prefs.allowBreaks}
            onChange={(event) => {
              const minutes = Number(event.target.value);
              if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 240) {
                patch({ breakIntervalMinutes: minutes });
              }
            }}
            className="w-32 rounded-2xl border border-line bg-background px-4 py-3 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <p className="text-sm text-ink-soft">Between 1 and 240 minutes.</p>
        </div>
      </fieldset>

      <p className="text-sm text-ink-soft">
        Nothing here asks about, stores, or requires any diagnosis — these are
        your preferences, full stop. Keyboard navigation and screen-reader
        support are built into every page, always on.
      </p>
    </div>
  );
}
