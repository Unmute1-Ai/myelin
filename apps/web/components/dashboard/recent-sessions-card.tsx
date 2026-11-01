/*
 * Card 8 — Recent sessions (spec §6.7): the persistent session list,
 * newest first. Sessions survive across visits (spec §5) — the card shows
 * their real status and stamps.
 */
import { MascotSlot } from "@/components/mascot-slot";
import { Card } from "@/components/ui";
import { formatDayTime } from "@/lib/format";
import type { TutoringSession } from "@workspace/api-zod";

const STATUS_STYLES: Record<TutoringSession["status"], string> = {
  active: "bg-success/10 text-success",
  completed: "bg-lavender text-ink-soft",
};

export function RecentSessionsCard({ sessions }: { sessions: TutoringSession[] }) {
  const sorted = [...sessions].sort(
    (a, b) =>
      new Date(b.lastTurnAt ?? b.startedAt).getTime() -
      new Date(a.lastTurnAt ?? a.startedAt).getTime(),
  );

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-xl font-extrabold text-ink">Recent sessions</h2>
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <MascotSlot variant="sessions" className="max-w-xs" />
          <p className="text-base text-ink-soft">
            No sessions yet — your conversations with your tutor will be saved here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {sorted.map((session) => (
            <li
              key={session.id}
              className="flex flex-col gap-1 rounded-2xl border border-line p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-base font-bold text-ink">{session.title ?? "Tutoring session"}</p>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${STATUS_STYLES[session.status]}`}
                >
                  {session.status}
                </span>
              </div>
              <p className="text-xs font-semibold text-ink-soft">
                Started {formatDayTime(session.startedAt)}
                {session.lastTurnAt
                  ? ` · last activity ${formatDayTime(new Date(session.lastTurnAt))}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
