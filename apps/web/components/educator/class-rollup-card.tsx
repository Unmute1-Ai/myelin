/*
 * Card 1 — Class gap report (spec §6.10): every granted-linked student with
 * their recorded gap count and open work. Students with gaps sort first and
 * carry a visible "needs support" mark; selection drives the supports card.
 * Server-scoped to granted links — this table can only ever contain
 * students the educator is authorized to see.
 */
import { Card } from "@/components/ui";
import { formatDay } from "@/lib/format";
import type { StudentGapRow } from "@/lib/educator-data";

export function ClassRollupCard({
  rows,
  selectedStudentId,
  onSelect,
}: {
  rows: StudentGapRow[];
  selectedStudentId: string | null;
  onSelect: (studentId: string) => void;
}) {
  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-extrabold text-ink">Class gap report</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Only students you are linked to appear here. Gap counts come from
          each learner&apos;s own evidence record — never from a label.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-base text-ink-soft">
          No linked students yet — request a link below and it will appear
          here once granted.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Linked students with gap counts and open assignments</caption>
            <thead>
              <tr className="border-b border-line text-ink-soft">
                <th scope="col" className="py-2 pr-4 font-bold">Student</th>
                <th scope="col" className="py-2 pr-4 font-bold">Recorded gaps</th>
                <th scope="col" className="py-2 pr-4 font-bold">Open work</th>
                <th scope="col" className="py-2 font-bold">Last active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.studentId}
                  className={`border-b border-line last:border-b-0 ${
                    row.studentId === selectedStudentId ? "bg-primary-soft" : ""
                  }`}
                >
                  <td className="py-3 pr-4">
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onSelect(row.studentId)}
                        aria-pressed={row.studentId === selectedStudentId}
                        className="rounded-full px-3 py-1 text-left font-bold text-primary underline-offset-4 hover:bg-primary-soft hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {row.displayName}
                        {row.needsSupport ? (
                          <span className="sr-only"> — has recorded gaps, may need support</span>
                        ) : null}
                      </button>
                      {row.needsSupport ? (
                        <span
                          aria-hidden="true"
                          className="whitespace-nowrap rounded-full bg-mascot px-2 py-0.5 text-xs font-bold text-ink"
                        >
                          needs support
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="py-3 pr-4 font-bold text-ink">{row.gapCount}</td>
                  <td className="py-3 pr-4 text-ink">{row.openAssignments}</td>
                  <td className="py-3 text-ink-soft">
                    {row.lastActiveAt === null ? "never" : formatDay(row.lastActiveAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
