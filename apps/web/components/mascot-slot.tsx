/*
 * Mascot slot — documented placeholder, not a blocker (scaffold directive).
 *
 * The approved mascot art (character sheet art_LGiP8cEA and its production
 * variants) ships as project files in a later wave. When it lands:
 *   1. Put the files in `apps/web/public/mascot/`.
 *   2. Render them here (next/image) and delete the placeholder styling.
 *
 * The space this component reserves is sized for the dashboard-card
 * composition so surrounding layouts do not shift when real art arrives.
 * Alt text stays literal: screen readers must never guess at art.
 */
export function MascotSlot({
  label = "PRIMER mascot — illustration arrives in a later wave",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`flex min-h-40 items-center justify-center rounded-card border border-dashed border-line bg-lavender-soft p-6 text-center text-sm font-semibold text-ink-soft ${className}`}
    >
      {label}
    </div>
  );
}
