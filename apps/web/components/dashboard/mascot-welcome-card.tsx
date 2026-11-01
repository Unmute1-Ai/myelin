/*
 * Card 1 — Mascot welcome (spec §6.7): the dashboard greets the learner with
 * the light-background art per the art system usage notes (art_4J78bf2H).
 * The greeting is live text overlaid beside the art — never baked into it.
 */
import { MascotSlot } from "@/components/mascot-slot";
import { Card } from "@/components/ui";

export function MascotWelcomeCard({ displayName }: { displayName: string }) {
  return (
    <Card className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <MascotSlot variant="dashboard" className="sm:w-44 sm:shrink-0" priority />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-bold text-ink-soft">Welcome back</p>
        <h2 className="text-2xl font-extrabold text-ink">{displayName}</h2>
        <p className="text-base text-ink-soft">
          Your dashboard is ready. Pick up where you left off, or try something new.
        </p>
      </div>
    </Card>
  );
}
