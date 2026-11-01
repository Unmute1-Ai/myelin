/*
 * Card 4 — Subject list (spec §6.7): the student's explicit subject choices
 * as chips. Subjects come from the profile — the learner's own picks, never
 * inferred.
 */
import { MascotSlot } from "@/components/mascot-slot";
import { Card } from "@/components/ui";

export function SubjectListCard({ subjects }: { subjects: string[] }) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-xl font-extrabold text-ink">Your subjects</h2>
      {subjects.length === 0 ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <MascotSlot variant="welcome" className="max-w-xs" />
          <p className="text-base text-ink-soft">
            No subjects yet — add your first one in your profile below.
          </p>
        </div>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label="Subjects you chose">
          {subjects.map((subject) => (
            <li
              key={subject}
              className="rounded-full bg-lavender px-4 py-2 text-sm font-bold text-primary"
            >
              {subject}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
