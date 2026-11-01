// Contract schema tests (spec §7.12). The generated @workspace/api-zod
// schemas are the shared vocabulary every lane consumes, so these tests pin
// the contract to the platform data model in lib/db (spec §5): same enums,
// same shapes, same bounds — plus the two hard privacy guarantees (no
// password hash in DTOs, no diagnosis vocabulary anywhere) and the
// Sentinel/adaptive fields the UI lanes render (spec §6.2, §6.3, §6.11).
//
// The generated code is never edited by hand — when a test fails here, fix
// `lib/api-spec/openapi.yaml` and regenerate (`pnpm --filter @workspace/api-spec codegen`).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessmentEvidenceKind,
  auditDecision,
  consentStatus,
  consentType,
  masteryLevel,
  profileEntryKind,
  progressEventKind,
  sessionStatus,
  textSize,
  turnAuthor,
  userRole,
} from "@workspace/db/schema";
import {
  CreateGuardianLinkBody,
  CreateGuardianLinkResponse,
  CreateProfileEntryBody,
  CreateSessionBody,
  GetAccessibilityPrefsResponse,
  GetStudentProfileResponse,
  ListProfileEntriesQueryParams,
  ListProgressEventsQueryParams,
  ListProgressEventsResponse,
  ListSessionsQueryParams,
  PostSessionTurnBody,
  PostSessionTurnResponse,
  RecordConsentBody,
  RecordConsentResponse,
  UpdateAccessibilityPrefsBody,
  UpdateLearningProfileBody,
  type Assessment,
  type AuditDecision,
  type MasteryLevel,
  type User,
  type UserRole,
} from "./index";

// ---------------------------------------------------------------------------
// Fixtures — wire-format payloads (ISO timestamps, RFC4122 uuids) as they
// arrive over HTTP, before the generated zod coerces them.
// ---------------------------------------------------------------------------

const UUID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const ISO = "2026-11-01T10:00:00.000Z";

const turn = (author: "student" | "tutor") => ({
  id: UUID,
  sessionId: UUID,
  seq: 1,
  author,
  content: "Two quarters make fifty cents.",
  strategyId: null,
  kind: null,
  stepId: null,
  createdAt: ISO,
});

const assessment = {
  id: UUID,
  studentId: UUID,
  sessionId: UUID,
  turnId: UUID,
  subject: "math",
  skill: null,
  level: "recognition",
  evidenceKind: "recall",
  evidenceNote: "Correct on the second try without prompting.",
  createdAt: ISO,
};

// ---------------------------------------------------------------------------
// Type-level mirrors — compile-time assertions that the generated unions and
// DTOs match the DB vocabulary exactly. These run under `pnpm run typecheck`.
// ---------------------------------------------------------------------------

type AssertEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Union<T extends readonly string[]> = T[number];

const typeMirrors: [
  AssertEqual<UserRole, Union<typeof userRole.enumValues>>,
  AssertEqual<AuditDecision, Union<typeof auditDecision.enumValues>>,
  AssertEqual<MasteryLevel, Union<typeof masteryLevel.enumValues>>,
  AssertEqual<
    Assessment["evidenceKind"],
    Union<typeof assessmentEvidenceKind.enumValues>
  >,
] = [true, true, true, true];

// The User DTO must not carry the auth-boundary secret (spec §6.1).
type NoPasswordHash = "passwordHash" extends keyof User ? false : true;
const userDtoExcludesPasswordHash: NoPasswordHash = true;

describe("contract mirrors the lib/db enums (spec §5)", () => {
  it("accepts every DB session status in the sessions query", () => {
    for (const status of sessionStatus.enumValues) {
      expect(ListSessionsQueryParams.safeParse({ status }).success).toBe(true);
    }
  });

  it("accepts every DB consent status on a guardian link", () => {
    const link = {
      id: UUID,
      parentId: UUID,
      studentId: UUID,
      status: "pending",
      createdAt: ISO,
      updatedAt: ISO,
      student: { id: UUID, email: "student@example.com", displayName: "Sam" },
    };
    for (const status of consentStatus.enumValues) {
      const parsed = CreateGuardianLinkResponse.safeParse({ ...link, status });
      expect(parsed.success).toBe(true);
    }
  });

  it("accepts every DB turn author in the stored turns", () => {
    for (const author of turnAuthor.enumValues) {
      const parsed = PostSessionTurnResponse.safeParse({
        studentTurn: turn("student"),
        tutorTurn: turn(author),
        recordedAssessments: [],
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("accepts every DB profile entry kind, in body and query", () => {
    for (const kind of profileEntryKind.enumValues) {
      expect(ListProfileEntriesQueryParams.safeParse({ kind }).success).toBe(
        true,
      );
      expect(
        CreateProfileEntryBody.safeParse({
          kind,
          detail: "Mixed up area and perimeter.",
        }).success,
      ).toBe(true);
    }
  });

  it("accepts every DB progress event kind, in body and query", () => {
    for (const kind of progressEventKind.enumValues) {
      expect(ListProgressEventsQueryParams.safeParse({ kind }).success).toBe(
        true,
      );
    }
  });

  it("accepts every DB consent type in the consent record", () => {
    for (const type of consentType.enumValues) {
      expect(
        RecordConsentBody.safeParse({ type, termsVersion: "2026-11-01" })
          .success,
      ).toBe(true);
    }
  });

  it("accepts every DB text size in prefs body and response", () => {
    for (const size of textSize.enumValues) {
      expect(
        UpdateAccessibilityPrefsBody.safeParse({ textSize: size }).success,
      ).toBe(true);
      expect(
        GetAccessibilityPrefsResponse.safeParse({
          id: UUID,
          userId: UUID,
          ttsEnabled: false,
          captionsEnabled: true,
          highContrast: false,
          textSize: size,
          reducedMotion: false,
          aacInputEnabled: false,
          allowBreaks: true,
          breakIntervalMinutes: 20,
          createdAt: ISO,
          updatedAt: ISO,
        }).success,
      ).toBe(true);
    }
  });

  it("accepts every DB mastery level in the assessment DTO", () => {
    for (const level of masteryLevel.enumValues) {
      expect(
        PostSessionTurnResponse.safeParse({
          studentTurn: turn("student"),
          tutorTurn: turn("tutor"),
          recordedAssessments: [{ ...assessment, level }],
        }).success,
      ).toBe(true);
    }
  });

  it("accepts every DB evidence kind in the assessment DTO", () => {
    for (const evidenceKind of assessmentEvidenceKind.enumValues) {
      expect(
        PostSessionTurnResponse.safeParse({
          studentTurn: turn("student"),
          tutorTurn: turn("tutor"),
          recordedAssessments: [{ ...assessment, evidenceKind }],
        }).success,
      ).toBe(true);
    }
  });

  it("rejects vocabulary the DB does not know", () => {
    expect(
      ListSessionsQueryParams.safeParse({ status: "archived" }).success,
    ).toBe(false);
    expect(
      RecordConsentBody.safeParse({ type: "marketing", termsVersion: "1" })
        .success,
    ).toBe(false);
    expect(
      ListProfileEntriesQueryParams.safeParse({ kind: "vibe" }).success,
    ).toBe(false);
    expect(
      PostSessionTurnResponse.safeParse({
        studentTurn: turn("student"),
        tutorTurn: turn("tutor"),
        recordedAssessments: [{ ...assessment, level: "expert" }],
      }).success,
    ).toBe(false);
  });
});

describe("entity shapes mirror the lib/db rows", () => {
  it("coerces ISO timestamps into Dates and keeps nullable fields nullable", () => {
    const parsed = RecordConsentResponse.parse({
      id: UUID,
      guardianLinkId: UUID,
      type: "guardian_access",
      grantedAt: ISO,
      revokedAt: null,
      termsVersion: "2026-11-01",
      createdAt: ISO,
    });
    expect(parsed.grantedAt).toBeInstanceOf(Date);
    expect(parsed.revokedAt).toBeNull();
  });

  it("round-trips a full turn exchange with adaptive metadata", () => {
    const parsed = PostSessionTurnResponse.parse({
      studentTurn: turn("student"),
      tutorTurn: turn("tutor"),
      spokenReply: "Two quarters is fifty cents.",
      proposedAction: "assign_practice",
      checkLine: "Want two practice problems with pictures?",
      strategyId: "visual",
      strategyWhy:
        "The last two step-by-step attempts stalled, so we're trying pictures.",
      recordedAssessments: [assessment],
    });
    expect(parsed.studentTurn.createdAt).toBeInstanceOf(Date);
    expect(parsed.tutorTurn.strategyId).toBeNull();
    expect(parsed.recordedAssessments[0].level).toBe("recognition");
    expect(parsed.proposedAction).toBe("assign_practice");
  });

  it("round-trips a student profile with an empty entry record", () => {
    const parsed = GetStudentProfileResponse.parse({
      profile: {
        id: UUID,
        studentId: UUID,
        subjects: ["math", "science"],
        preferredStrategy: "visual",
        pacing: "standard",
        createdAt: ISO,
        updatedAt: ISO,
      },
      entries: [],
    });
    expect(parsed.profile.subjects).toEqual(["math", "science"]);
    expect(parsed.entries).toEqual([]);
  });

  it("keeps progress event payloads open as arbitrary JSON", () => {
    const query = ListProgressEventsQueryParams.parse({ since: ISO });
    expect(query.since).toBeInstanceOf(Date);
    const event = {
      id: UUID,
      studentId: UUID,
      actorId: null,
      sessionId: null,
      kind: "mastery_changed",
      summary: "Fractions moved from recognition to comprehension.",
      payload: { anything: [1, "two", { three: true }], nested: { a: null } },
      createdAt: ISO,
    };
    const parsed = ListProgressEventsResponse.safeParse({ events: [event] });
    expect(parsed.success).toBe(true);
  });
});

describe("requests are partial or bounded exactly as the DB is", () => {
  it("lets PATCH bodies be empty partials", () => {
    expect(UpdateAccessibilityPrefsBody.safeParse({}).success).toBe(true);
    expect(UpdateLearningProfileBody.safeParse({}).success).toBe(true);
    expect(CreateSessionBody.safeParse({}).success).toBe(true);
  });

  it("allows explicitly clearing the preferred strategy", () => {
    const parsed = UpdateLearningProfileBody.parse({ preferredStrategy: null });
    expect(parsed.preferredStrategy).toBeNull();
  });

  it("mirrors the 1–240 break interval bound (accessibility DB check)", () => {
    expect(
      UpdateAccessibilityPrefsBody.safeParse({ breakIntervalMinutes: 1 })
        .success,
    ).toBe(true);
    expect(
      UpdateAccessibilityPrefsBody.safeParse({ breakIntervalMinutes: 240 })
        .success,
    ).toBe(true);
    expect(
      UpdateAccessibilityPrefsBody.safeParse({ breakIntervalMinutes: 0 })
        .success,
    ).toBe(false);
    expect(
      UpdateAccessibilityPrefsBody.safeParse({ breakIntervalMinutes: 241 })
        .success,
    ).toBe(false);
  });

  it("bounds learner turn content and requires it non-empty", () => {
    expect(PostSessionTurnBody.safeParse({ content: "hi" }).success).toBe(true);
    expect(PostSessionTurnBody.safeParse({ content: "" }).success).toBe(false);
    expect(
      PostSessionTurnBody.safeParse({ content: "x".repeat(4001) }).success,
    ).toBe(false);
  });

  it("validates uuid and email formats", () => {
    expect(
      CreateGuardianLinkBody.safeParse({ studentEmail: "kid@example.com" })
        .success,
    ).toBe(true);
    expect(
      CreateGuardianLinkBody.safeParse({ studentEmail: "not-an-email" })
        .success,
    ).toBe(false);
    expect(
      GetStudentProfileResponse.safeParse({ profile: {}, entries: [] }).success,
    ).toBe(false);
  });

  it("requires a terms version and an entry detail", () => {
    expect(
      RecordConsentBody.safeParse({ type: "guardian_access" }).success,
    ).toBe(false);
    expect(CreateProfileEntryBody.safeParse({ kind: "gap" }).success).toBe(
      false,
    );
  });
});

describe("privacy guarantees hold in the generated contract", () => {
  it("no generated file declares a diagnosis field (spec §7.10)", () => {
    const generatedRoot = join(__dirname, "generated");
    const files = [
      join(generatedRoot, "api.ts"),
      ...readdirSync(join(generatedRoot, "types")).map((f) =>
        join(generatedRoot, "types", f),
      ),
    ];
    // Scan code structure only: prose descriptions legitimately discuss the
    // policy ("no diagnosis field exists"), so strip .describe() payloads and
    // comments before looking for diagnosis identifiers.
    const scrub = (src: string) =>
      src
        .replace(/\.describe\((['`])(?:\\.|(?!\1).)*\1\)/gs, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
    const offenders = files.filter((f) =>
      /\bdiagnos/i.test(scrub(readFileSync(f, "utf8"))),
    );
    expect(offenders).toEqual([]);
  });

  it("the learning profile update accepts explicit choices only", () => {
    const parsed = UpdateLearningProfileBody.safeParse({
      subjects: ["math"],
      preferredStrategy: "step_by_step",
      pacing: "slower",
    });
    expect(parsed.success).toBe(true);
  });
});
