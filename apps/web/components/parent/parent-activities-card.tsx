/*
 * At-home activities (spec §6.9): suggestions derived from the learner's own
 * record, with the motivating evidence quoted. Suggestions are inert —
 * nothing here writes to the record or schedules anything; a parent chooses
 * what to do with them.
 */
"use client";

import { Card } from "@/components/ui";
import type { AtHomeActivity } from "@workspace/api-zod";

export function ParentActivitiesCard({ activities }: { activities: AtHomeActivity[] }) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-xl font-extrabold text-ink">At-home activities</h2>
      {activities.length === 0 ? (
        <p className="text-base text-ink-soft">
          Nothing suggested right now — steady progress needs no extra assignments.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Suggested at-home activities">
          {activities.map((activity) => (
            <li
              key={activity.id}
              className="flex flex-col gap-1 rounded-card border border-line bg-background px-4 py-3"
            >
              <span className="text-base font-bold text-ink">{activity.title}</span>
              <span className="text-sm text-ink-soft">
                Because: {activity.reason}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-ink-soft">
        Every suggestion quotes the record that motivated it — no black-box recommendations.
      </p>
    </Card>
  );
}
