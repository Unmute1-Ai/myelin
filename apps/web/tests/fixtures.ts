/*
 * Contract-typed fixtures for the dashboard tests. Shapes mirror the
 * generated @workspace/api-zod types exactly — Date fields are real Dates
 * because the generated validators parse timestamps into Dates.
 */
import {
  MasteryLevel,
  ProfileEntryKind,
  ProgressEventKind,
  SessionStatus,
  TextSize,
  type AccessibilityPrefs,
  type AtHomeActivity,
  type AuthUser,
  type LearningProfile,
  type MasteryCounts,
  type ParentMasteryOverview,
  type ParentSessionSummary,
  type ParentStudent,
  type ParentSubjectMastery,
  type ProfileEntry,
  type ProgressEvent,
  type TutoringSession,
} from "@workspace/api-zod";

export function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "u-student-1",
    email: "sam@example.com",
    role: "student",
    displayName: "Sam",
    createdAt: new Date("2026-10-01T10:00:00Z"),
    ...overrides,
  };
}

export function makeProfile(overrides: Partial<LearningProfile> = {}): LearningProfile {
  return {
    id: "lp-1",
    studentId: "u-student-1",
    subjects: ["Money math"],
    preferredStrategy: null,
    pacing: "standard",
    createdAt: new Date("2026-10-01T10:00:00Z"),
    updatedAt: new Date("2026-10-01T10:00:00Z"),
    ...overrides,
  };
}

export function makeEntry(overrides: Partial<ProfileEntry> = {}): ProfileEntry {
  return {
    id: "entry-1",
    profileId: "lp-1",
    kind: ProfileEntryKind.preference,
    subject: null,
    detail: "Pictures help me understand fractions",
    whyChanged: null,
    sourceAssessmentId: null,
    sourceTurnId: null,
    createdAt: new Date("2026-10-02T10:00:00Z"),
    updatedAt: new Date("2026-10-02T10:00:00Z"),
    ...overrides,
  };
}

export function makeProgressEvent(overrides: Partial<ProgressEvent> = {}): ProgressEvent {
  return {
    id: "pe-1",
    studentId: "u-student-1",
    actorId: "u-student-1",
    sessionId: null,
    kind: ProgressEventKind.assessment_recorded,
    summary: "Assessment recorded for Money math",
    payload: { level: MasteryLevel.comprehension, evidenceKind: "independent_application" },
    createdAt: new Date("2026-10-03T10:00:00Z"),
    ...overrides,
  };
}

export function makeSession(overrides: Partial<TutoringSession> = {}): TutoringSession {
  return {
    id: "s-1",
    studentId: "u-student-1",
    title: "Money math practice",
    status: SessionStatus.active,
    startedAt: new Date("2026-10-03T09:00:00Z"),
    lastTurnAt: "2026-10-03T09:30:00Z",
    endedAt: null,
    pendingAction: null,
    pendingCheckLine: null,
    ...overrides,
  };
}

export function makePrefs(overrides: Partial<AccessibilityPrefs> = {}): AccessibilityPrefs {
  return {
    id: "ap-1",
    userId: "u-student-1",
    ttsEnabled: false,
    captionsEnabled: true,
    highContrast: false,
    textSize: TextSize.medium,
    reducedMotion: false,
    aacInputEnabled: true,
    allowBreaks: true,
    breakIntervalMinutes: 25,
    createdAt: new Date("2026-10-01T10:00:00Z"),
    updatedAt: new Date("2026-10-01T10:00:00Z"),
    ...overrides,
  };
}

// ── Parent-dashboard fixtures (spec §6.9) ───────────────────────────────────

export function makeParentUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return makeUser(
    {
      id: "u-parent-1",
      email: "parent@example.com",
      role: "parent",
      displayName: "Pat",
      ...overrides,
    },
  );
}

export function makeParentStudent(
  overrides: Partial<ParentStudent> = {},
): ParentStudent {
  return {
    id: "u-student-1",
    email: "sam@example.com",
    displayName: "Sam",
    linkStatus: "granted",
    accessGranted: true,
    ...overrides,
  };
}

const EMPTY_COUNTS: MasteryCounts = {
  memorization: 0,
  recognition: 0,
  comprehension: 0,
  application: 0,
  mastery: 0,
};

export function makeSubjectMastery(
  overrides: Partial<ParentSubjectMastery> = {},
): ParentSubjectMastery {
  return {
    subject: "Money math",
    counts: { ...EMPTY_COUNTS, comprehension: 1, recognition: 1 },
    evidenceCount: 2,
    highestLevel: MasteryLevel.comprehension,
    lastEvidenceAt: new Date("2026-10-30T10:00:00Z"),
    ...overrides,
  };
}

export function makeMasteryOverview(
  overrides: Partial<ParentMasteryOverview> = {},
): ParentMasteryOverview {
  return {
    student: {
      id: "u-student-1",
      email: "sam@example.com",
      displayName: "Sam",
    },
    subjects: [makeSubjectMastery()],
    ...overrides,
  };
}

export function makeParentSessionSummary(
  overrides: Partial<ParentSessionSummary> = {},
): ParentSessionSummary {
  return {
    id: "s-1",
    title: "Money math practice",
    status: SessionStatus.active,
    startedAt: new Date("2026-10-03T09:00:00Z"),
    lastTurnAt: "2026-10-03T09:30:00Z",
    endedAt: null,
    turnCount: 7,
    ...overrides,
  };
}

export function makeAtHomeActivity(
  overrides: Partial<AtHomeActivity> = {},
): AtHomeActivity {
  return {
    id: "home-practice-money-math",
    subject: "Money math",
    title: "Practice together: Money math",
    reason: "Struggled to compare unlike denominators twice",
    ...overrides,
  };
}
