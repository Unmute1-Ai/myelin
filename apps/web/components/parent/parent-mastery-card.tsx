/*
 * Parent mastery overview (spec §6.9): per-subject evidence summaries for a
 * linked learner. Every number comes from stored, non-revoked assessments —
 * the card renders the contract's evidence counts; it never invents a level
 * or an average. Before the first assessment, the mascot empty state shows
 * instead of zeros pretending to be data.
 */
"use client";

import { MascotSlot } from "@/components/mascot-slot";
import { Card } from "@/components/ui";
import { MASTERY_RUNG_LABELS, formatDay } from "@/lib/format";
import type { ParentMasteryOverview } from "@workspace/api-zod";

export function ParentMasteryCard({ overview }: { overview: ParentMasteryOverview }) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-xl font-extrabold text-ink">Mastery overview</h2>
      {overview.subjects.length === 0 ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <MascotSlot variant="progress" className="max-w-xs" />
          <p className="text-base text-ink-soft">
            {overview.student.displayName}&apos;s evidence board fills in as assessments are
            recorded — nothing to show yet.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Mastery by subject">
          {overview.subjects.map((subject) => (
            <li
              key={subject.subject}
              className="flex flex-col gap-1.5 rounded-card border border-line bg-background px-4 py-3"
            >
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-base font-bold text-ink">{subject.subject}</span>
                <span className="text-sm font-bold text-primary">
                  {subject.highestLevel === null
                    ? "No evidence yet"
                    : MASTERY_RUNG_LABELS[subject.highestLevel]}
                </span>
              </span>
              <span className="text-sm text-ink-soft">
                {subject.evidenceCount} assessment{subject.evidenceCount === 1 ? "" : "s"}
                {subject.lastEvidenceAt === null
                  ? ""
                  : ` · latest ${formatDay(subject.lastEvidenceAt)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-ink-soft">
        Levels come from recorded assessments only — higher levels require independent
        application, never a single correct answer.
      </p>
    </Card>
  );
}
