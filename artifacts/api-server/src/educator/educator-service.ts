// Educator dashboard data (spec §6.10). The port keeps the routes honest
// about scope: every method is keyed by ids the caller has already
// authorized — none of these lookups re-decides access, they only fetch
// rows the authorization boundary has admitted.
import type {
  EducatorAssignment,
  EducatorLink,
  EducatorSupports,
} from "@workspace/db/schema";

/** A link row joined with the student's identity for the response view. */
export interface EducatorLinkRow extends EducatorLink {
  studentEmail: string;
  studentDisplayName: string;
}

/** Per-student rollup backing GET /educator/students (contract: EducatorStudentSummary). */
export interface ClassSummaryFact {
  studentId: string;
  displayName: string;
  /** Live (uninvalidated) gap entries in the student's learning record. */
  gapCount: number;
  masteryCounts: {
    memorization: number;
    recognition: number;
    comprehension: number;
    application: number;
    mastery: number;
  };
  lastActiveAt: Date | null;
}

export type LinkStatus = "pending" | "granted" | "revoked";

export interface NewAssignment {
  educatorId: string;
  studentId: string;
  title: string;
  detail: string | null;
  subject: string | null;
}

export interface SupportsUpdate {
  supports: string[];
  notes: string | null;
}

export interface EducatorDataPort {
  /** The user exists and holds the student role (never an educator id). */
  studentExists(studentId: string): Promise<boolean>;
  studentIdByEmail(email: string): Promise<string | undefined>;
  /** One educator's links, or every link when no educatorId is given (admin view). */
  listLinks(educatorId?: string): Promise<EducatorLinkRow[]>;
  findLinkByPair(educatorId: string, studentId: string): Promise<EducatorLinkRow | undefined>;
  createLink(educatorId: string, studentId: string): Promise<EducatorLinkRow>;
  setLinkStatus(linkId: string, status: LinkStatus): Promise<EducatorLinkRow>;
  listAssignments(educatorId: string): Promise<EducatorAssignment[]>;
  createAssignment(input: NewAssignment): Promise<EducatorAssignment>;
  getSupports(studentId: string): Promise<EducatorSupports | undefined>;
  upsertSupports(
    studentId: string,
    update: SupportsUpdate,
    updatedBy: string,
  ): Promise<EducatorSupports>;
  /** Gap + mastery rollup for exactly these students — ids pre-scoped by the route. */
  listClassSummaries(studentIds: string[]): Promise<ClassSummaryFact[]>;
}
