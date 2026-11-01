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
  type AuthUser,
  type LearningProfile,
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
