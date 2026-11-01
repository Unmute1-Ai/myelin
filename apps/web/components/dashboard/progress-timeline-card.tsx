/*
 * Card 5 — Progress view (spec §6.7): the append-only timeline as readable
 * rows. Every row is a real progress event with its kind and timestamp —
 * the view never reorders or annotates what the record doesn't say.
 */
import { MascotSlot } from "@/components/mascot-slot";
import { Card } from "@/components/ui";
import { formatDayTime, humanizeKind } from "@/lib/format";
import type { ProgressEvent } from "@workspace/api-zod";

export function ProgressTimelineCard({ events }: { events: ProgressEvent[] }) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-xl font-extrabold text-ink">Your progress</h2>
      {events.length === 0 ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <MascotSlot variant="progress" className="max-w-xs" />
          <p className="text-base text-ink-soft">
            Nothing here yet — your first assessment or session will appear as soon as it happens.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-3" aria-label="Progress timeline">
          {events.map((event) => (
            <li
              key={event.id}
              className="flex flex-col gap-1 rounded-2xl border border-line p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-bold text-primary">
                  {humanizeKind(event.kind)}
                </span>
                <time
                  dateTime={new Date(event.createdAt).toISOString()}
                  className="text-xs font-semibold text-ink-soft"
                >
                  {formatDayTime(event.createdAt)}
                </time>
              </div>
              <p className="text-sm text-ink">{event.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
