/*
 * Card 6 — Mastery visualization (spec §6.7): the evidence-backed ladder.
 * Every rung count comes from deriveMasteryLadder over real assessment
 * events; before the first assessment the card shows the mascot empty state
 * rather than zeros pretending to be data.
 */
import { MascotSlot } from "@/components/mascot-slot";
import { Card } from "@/components/ui";
import { MASTERY_RUNG_LABELS } from "@/lib/format";
import { MASTERY_LADDER, type MasteryLadder } from "@/lib/dashboard-data";

export function MasteryEvidenceCard({ ladder }: { ladder: MasteryLadder }) {
  const total = Object.values(ladder.counts).reduce((sum, n) => sum + n, 0);

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-xl font-extrabold text-ink">Mastery evidence</h2>
      {total === 0 ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <MascotSlot variant="progress" className="max-w-xs" />
          <p className="text-base text-ink-soft">
            Your mastery ladder fills in as you show what you know — first assessment first.
          </p>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2" aria-label="Mastery counts by level">
            {MASTERY_LADDER.map((rung) => {
              const count = ladder.counts[rung];
              const share = total === 0 ? 0 : Math.round((count / total) * 100);
              return (
                <li key={rung} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-sm font-bold text-ink">
                    {MASTERY_RUNG_LABELS[rung]}
                  </span>
                  <span
                    role="meter"
                    aria-valuenow={count}
                    aria-valuemin={0}
                    aria-valuemax={total}
                    aria-label={`${MASTERY_RUNG_LABELS[rung]}: ${count} of ${total}`}
                    className="h-3 flex-1 overflow-hidden rounded-full bg-lavender"
                  >
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${share}%` }}
                    />
                  </span>
                  <span className="w-6 text-right text-sm font-bold text-ink-soft">{count}</span>
                </li>
              );
            })}
          </ul>
          <p className="text-sm text-ink-soft">
            Counts come from your recorded assessments, each with its evidence — higher levels
            require independent application (spec §6.3).
          </p>
        </>
      )}
    </Card>
  );
}
