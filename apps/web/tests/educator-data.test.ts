/*
 * Pure-derivation tests for the educator dashboard (spec §6.10). The
 * derivations join the rollup with open assignments and order the gap
 * report — the assertions pin exactly that, and nothing about filtering
 * (the server scopes rows to granted links before the UI ever sees them).
 */
import { describe, expect, it } from "vitest";
import type { EducatorAssignment, EducatorStudentSummary } from "@workspace/api-zod";
import { deriveClassOverview, deriveObjectives, summarizeClass } from "@/lib/educator-data";
import { makeEducatorAssignment, makeStudentSummary } from "./fixtures";

function student(overrides: Partial<EducatorStudentSummary> = {}): EducatorStudentSummary {
  return makeStudentSummary(overrides);
}

function assignment(overrides: Partial<EducatorAssignment> = {}): EducatorAssignment {
  return makeEducatorAssignment(overrides);
}

describe("deriveClassOverview", () => {
  it("joins open per-student assignments onto each rollup row", () => {
    const rows = deriveClassOverview(
      [student({ studentId: "u-s-1", displayName: "Sam" })],
      [
        assignment({ studentId: "u-s-1", status: "open" }),
        assignment({ studentId: "u-s-1", status: "completed" }),
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      studentId: "u-s-1",
      displayName: "Sam",
      openAssignments: 1,
      gapCount: 0,
      needsSupport: false,
    });
  });

  it("sorts students with recorded gaps before gap-free students", () => {
    const rows = deriveClassOverview(
      [
        student({ studentId: "u-clean", displayName: "Zoe", gapCount: 0 }),
        student({ studentId: "u-gaps", displayName: "Amy", gapCount: 3 }),
        student({ studentId: "u-mid", displayName: "Bo", gapCount: 1 }),
      ],
      [],
    );
    expect(rows.map((row) => row.displayName)).toEqual(["Amy", "Bo", "Zoe"]);
    expect(rows.map((row) => row.needsSupport)).toEqual([true, true, false]);
  });

  it("ties on gap count break alphabetically for stable order", () => {
    const rows = deriveClassOverview(
      [
        student({ studentId: "u-b", displayName: "Bo", gapCount: 2 }),
        student({ studentId: "u-a", displayName: "Amy", gapCount: 2 }),
      ],
      [],
    );
    expect(rows.map((row) => row.displayName)).toEqual(["Amy", "Bo"]);
  });

  it("renders an empty class as an empty report", () => {
    expect(deriveClassOverview([], [])).toEqual([]);
  });
});

describe("summarizeClass", () => {
  it("totals students, students with gaps, and gaps", () => {
    const rows = deriveClassOverview(
      [
        student({ studentId: "u-1", displayName: "Amy", gapCount: 2 }),
        student({ studentId: "u-2", displayName: "Bo", gapCount: 0 }),
        student({ studentId: "u-3", displayName: "Cy", gapCount: 1 }),
      ],
      [],
    );
    expect(summarizeClass(rows)).toEqual({
      totalStudents: 3,
      studentsWithGaps: 2,
      totalGaps: 3,
    });
  });
});

describe("deriveObjectives", () => {
  it("lists only open assignments, newest first", () => {
    const objectives = deriveObjectives([
      assignment({
        id: "ea-old",
        title: "Counting coins",
        createdAt: new Date("2026-10-29T10:00:00Z"),
      }),
      assignment({
        id: "ea-new",
        title: "Making change",
        createdAt: new Date("2026-10-31T10:00:00Z"),
      }),
      assignment({
        id: "ea-done",
        title: "Completed worksheet",
        status: "completed",
        createdAt: new Date("2026-11-01T10:00:00Z"),
      }),
    ]);
    expect(objectives.map((objective) => objective.id)).toEqual(["ea-new", "ea-old"]);
  });

  it("keeps the assigned student on each row", () => {
    const objectives = deriveObjectives([assignment({ studentId: "u-s-1" })]);
    expect(objectives.map((objective) => objective.studentId)).toEqual(["u-s-1"]);
  });
});
