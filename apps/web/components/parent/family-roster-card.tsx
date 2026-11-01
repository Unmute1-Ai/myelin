/*
 * Family roster (spec §6.9): the parent's linked students. Every link is
 * listed honestly — a pending or revoked link shows its true state and
 * grants nothing (the server enforces that; the card just doesn't pretend).
 */
"use client";

import { Card } from "@/components/ui";
import type { ParentStudent } from "@workspace/api-zod";

const LINK_STATUS_LABELS: Record<ParentStudent["linkStatus"], string> = {
  granted: "Connected",
  pending: "Waiting for consent",
  revoked: "Consent revoked",
};

export function FamilyRosterCard({
  students,
  selectedStudentId,
  onSelect,
}: {
  students: ParentStudent[];
  selectedStudentId: string | null;
  onSelect: (studentId: string) => void;
}) {
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-xl font-extrabold text-ink">Your learners</h2>
      <ul className="flex flex-col gap-2" aria-label="Linked students">
        {students.map((student) => {
          const active = student.id === selectedStudentId;
          return (
            <li key={student.id}>
              <button
                type="button"
                onClick={() => onSelect(student.id)}
                aria-pressed={active}
                disabled={!student.accessGranted}
                className={`w-full rounded-card border px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 ${
                  active
                    ? "border-primary bg-primary-soft"
                    : "border-line bg-card hover:bg-lavender"
                }`}
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-base font-bold text-ink">{student.displayName}</span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${
                      student.accessGranted ? "bg-primary-soft text-ink" : "bg-lavender text-ink-soft"
                    }`}
                  >
                    {/* Access is the truth the badge tells: a granted link
                        without the recorded consent authority shows as
                        consent-pending, never as connected. */}
                    {student.accessGranted
                      ? "Connected"
                      : student.linkStatus === "granted"
                        ? "Consent pending"
                        : LINK_STATUS_LABELS[student.linkStatus]}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
