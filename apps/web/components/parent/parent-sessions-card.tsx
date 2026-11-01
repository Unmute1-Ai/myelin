/*
 * Parent session summaries (spec §6.9): engagement metadata only — status,
 * timing, and turn counts. The wire shape itself carries no turn content
 * (route tests pin exactly these keys); this card renders summaries, never
 * a transcript, because session conversations belong to the learner.
 */
"use client";

import { MascotSlot } from "@/components/mascot-slot";
import { Card } from "@/components/ui";
import { formatDayTime } from "@/lib/format";
import type { ParentSessionSummary } from "@workspace/api-zod";

const STATUS_LABELS: Record<ParentSessionSummary["status"], string> = {
  active: "In progress",
  completed: "Completed",
};

export function ParentSessionsCard({ summaries }: { summaries: ParentSessionSummary[] }) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-xl font-extrabold text-ink">Tutoring sessions</h2>
      {summaries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <MascotSlot variant="sessions" className="max-w-xs" />
          <p className="text-base text-ink-soft">
            No tutoring sessions yet — summaries appear after the first one.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Session summaries">
          {summaries.map((session) => (
            <li
              key={session.id}
              className="flex flex-col gap-1 rounded-card border border-line bg-background px-4 py-3"
            >
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-base font-bold text-ink">
                  {session.title ?? "Untitled session"}
                </span>
                <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-bold text-ink">
                  {STATUS_LABELS[session.status]}
                </span>
              </span>
              <span className="text-sm text-ink-soft">
                Started {formatDayTime(session.startedAt)} · {session.turnCount} turn
                {session.turnCount === 1 ? "" : "s"}
                {session.endedAt === null
                  ? ""
                  : ` · ended ${formatDayTime(new Date(session.endedAt))}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-ink-soft">
        Summaries only — session conversations stay private to your learner.
      </p>
    </Card>
  );
}
