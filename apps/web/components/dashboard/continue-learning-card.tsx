/*
 * Card 3 — Continue learning (spec §6.7): the student's most recent active
 * session, resume-ordered by lastTurnAt. The resume action opens the tutor
 * surface, which is a later wave in this release — the card says so instead
 * of linking nowhere. The data is real; the destination is not merged yet.
 */
import { Button, Card } from "@/components/ui";
import { MascotSlot } from "@/components/mascot-slot";
import { formatDayTime } from "@/lib/format";
import type { TutoringSession } from "@workspace/api-zod";

export function ContinueLearningCard({ session }: { session: TutoringSession | null }) {
  const title = session?.title ?? "Your latest session";
  const stamp = session
    ? `Last activity ${formatDayTime(new Date(session.lastTurnAt ?? session.startedAt))}`
    : null;

  return (
    <Card className="flex flex-col gap-3 bg-primary-soft">
      <h2 className="text-xl font-extrabold text-ink">Continue learning</h2>
      {session ? (
        <>
          <p className="text-base font-bold text-ink">{title}</p>
          {stamp ? <p className="text-sm text-ink-soft">{stamp}</p> : null}
          <div>
            <Button
              type="button"
              disabled
              title="The live tutor is arriving in a later release wave"
            >
              Resume session
            </Button>
            <p className="mt-2 text-xs font-semibold text-ink-soft">
              The live tutor opens in a later release wave — your session is saved and waiting.
            </p>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 text-center">
          <MascotSlot variant="welcome" className="max-w-xs" />
          <p className="text-base text-ink-soft">
            No sessions yet — your first tutoring conversation will appear here.
          </p>
        </div>
      )}
    </Card>
  );
}
