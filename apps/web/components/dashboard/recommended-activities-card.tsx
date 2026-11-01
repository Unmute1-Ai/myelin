/*
 * Card 7 — Recommended activities (spec §6.7): suggestions derived from the
 * transparent record by deriveRecommendations. The reason is always shown —
 * the learner sees why the record suggests it, per the transparency rule.
 */
import { MascotSlot } from "@/components/mascot-slot";
import { Card } from "@/components/ui";
import type { ActivityRecommendation } from "@/lib/dashboard-data";

export function RecommendedActivitiesCard({
  recommendations,
}: {
  recommendations: ActivityRecommendation[];
}) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-xl font-extrabold text-ink">Recommended for you</h2>
      {recommendations.length === 0 ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <MascotSlot variant="welcome" className="max-w-xs" />
          <p className="text-base text-ink-soft">
            Pick a subject in your profile and recommendations will show up here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {recommendations.map((rec) => (
            <li
              key={rec.id}
              className="flex flex-col gap-1 rounded-2xl border border-line bg-mascot-soft p-4"
            >
              <p className="text-base font-extrabold text-ink">{rec.title}</p>
              <p className="text-sm text-ink-soft">{rec.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
