/*
 * Pure derivations for the educator dashboard (spec §6.10): the class
 * rollup, per-student gap-report rows, and learning objectives. Named
 * functions over contract types — no component assembles this logic inline,
 * and no function invents evidence that isn't in the record.
 *
 * Ground truth about the data (verified this session): the educator rollup
 * is scoped server-side to granted links only — pending and revoked links
 * never produce rows here, so this module never needs to filter them. Gap
 * counts come from the student's own profile evidence upstream (spec §6.0);
 * a zero in this report means "no recorded gaps", never "no data".
 */
import type { EducatorAssignment, EducatorStudentSummary } from "@workspace/api-zod";

/** One row of the class gap report: the rollup joined with open work. */
export interface StudentGapRow {
  studentId: string;
  displayName: string;
  gapCount: number;
  /** Students with recorded gaps sort first — the actionable end of the list. */
  needsSupport: boolean;
  /** Open (not yet completed) assignments assigned to this student. */
  openAssignments: number;
  lastActiveAt: Date | null;
}

/**
 * The class gap report: every linked student with their open-assignment
 * count, most-gapped first (then by name for stable order). Every
 * assignment targets exactly one linked student (contract: studentId is
 * required), so the per-student open count is a simple group-by.
 */
export function deriveClassOverview(
  students: EducatorStudentSummary[],
  assignments: EducatorAssignment[],
): StudentGapRow[] {
  const openByStudent = new Map<string, number>();
  for (const assignment of assignments) {
    if (assignment.status !== "open") continue;
    openByStudent.set(assignment.studentId, (openByStudent.get(assignment.studentId) ?? 0) + 1);
  }
  return students
    .map((student) => ({
      studentId: student.studentId,
      displayName: student.displayName,
      gapCount: student.gapCount,
      needsSupport: student.gapCount > 0,
      openAssignments: openByStudent.get(student.studentId) ?? 0,
      lastActiveAt: student.lastActiveAt,
    }))
    .sort((a, b) => b.gapCount - a.gapCount || a.displayName.localeCompare(b.displayName));
}

/** Class-level summary line: totals for the rollup card header. */
export interface ClassSummary {
  totalStudents: number;
  studentsWithGaps: number;
  totalGaps: number;
}

export function summarizeClass(rows: StudentGapRow[]): ClassSummary {
  return {
    totalStudents: rows.length,
    studentsWithGaps: rows.filter((row) => row.needsSupport).length,
    totalGaps: rows.reduce((sum, row) => sum + row.gapCount, 0),
  };
}

/** One learning objective: an open assignment, newest first. */
export interface ObjectiveRow {
  id: string;
  title: string;
  subject: string | null;
  detail: string | null;
  studentId: string;
  createdAt: Date;
}

/** Learning objectives (spec §6.10) — open assignments, newest first. */
export function deriveObjectives(assignments: EducatorAssignment[]): ObjectiveRow[] {
  return assignments
    .filter((assignment) => assignment.status === "open")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      subject: assignment.subject,
      detail: assignment.detail,
      studentId: assignment.studentId,
      createdAt: assignment.createdAt,
    }));
}
