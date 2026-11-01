/*
 * Card 2 — Learning objectives (spec §6.7): the student's chosen subjects
 * with the governed gap focus where the record holds one. Data comes from
 * deriveLearningObjectives — no objective is invented here.
 */
import { MascotSlot } from "@/components/mascot-slot";
import { Card } from "@/components/ui";
import type { LearningObjective } from "@/lib/dashboard-data";

export function LearningObjectivesCard({ objectives }: { objectives: LearningObjective[] }) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-xl font-extrabold text-ink">Learning objectives</h2>
      {objectives.length === 0 ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <MascotSlot variant="progress" className="max-w-xs" />
          <p className="text-base text-ink-soft">
            You haven&apos;t picked any subjects yet — add one in your profile below to set your
            first objective.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {objectives.map((objective) => (
            <li
              key={objective.subject}
              className="flex flex-col gap-1 rounded-2xl border border-line bg-lavender-soft p-4"
            >
              <p className="text-base font-extrabold text-ink">{objective.subject}</p>
              {objective.focus ? (
                <p className="text-sm text-ink-soft">
                  <span className="font-bold text-primary">Focus:</span> {objective.focus}
                </p>
              ) : (
                <p className="text-sm text-ink-soft">Building your skills — keep going.</p>
              )}
              <p className="text-xs font-semibold text-ink-soft">
                {objective.evidenceCount} {objective.evidenceCount === 1 ? "entry" : "entries"} in
                your learning record
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
