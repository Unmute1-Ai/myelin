import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableName, getTableColumns, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import {
  accessibilityPrefs,
  assessments,
  auditLog,
  consents,
  guardianLinks,
  insertAccessibilityPrefsSchema,
  insertAssessmentSchema,
  insertAuditLogSchema,
  insertConsentSchema,
  insertGuardianLinkSchema,
  insertLearningProfileSchema,
  insertProfileEntrySchema,
  insertProgressEventSchema,
  insertSessionTurnSchema,
  insertTutoringSessionSchema,
  insertUserSchema,
  learningProfiles,
  profileEntries,
  progressEvents,
  sessionTurns,
  tutoringSessions,
  users,
} from "./index";

/** Spec §5 — exactly these tables, no more, no fewer. */
const EXPECTED_TABLES = [
  "users",
  "guardian_links",
  "consents",
  "learning_profiles",
  "profile_entries",
  "tutoring_sessions",
  "session_turns",
  "assessments",
  "progress_events",
  "accessibility_prefs",
  "audit_log",
] as const;

const tableExports: Record<string, unknown> = {
  users,
  guardianLinks,
  consents,
  learningProfiles,
  profileEntries,
  tutoringSessions,
  sessionTurns,
  assessments,
  progressEvents,
  accessibilityPrefs,
  auditLog,
};

const tables = Object.values(tableExports).filter(
  (v): v is PgTable => is(v, PgTable),
);

const DRIZZLE_DIR = fileURLToPath(new URL("../../drizzle", import.meta.url));

function migrationSqlFiles(): string[] {
  return readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

describe("platform table set", () => {
  it("defines exactly the spec §5 tables", () => {
    const names = tables.map((t) => getTableName(t)).sort();
    expect(names).toEqual([...EXPECTED_TABLES].sort());
  });
});

describe("privacy invariant: no diagnosis field (spec §7.10)", () => {
  it("has no column matching /diagnos/i on any table", () => {
    for (const table of tables) {
      const columns = Object.keys(getTableColumns(table));
      const offenders = columns.filter((c) => /diagnos/i.test(c));
      expect(offenders, `table ${getTableName(table)}`).toEqual([]);
    }
  });

  it("has no diagnosis reference in any generated migration", () => {
    const files = migrationSqlFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const sql = readFileSync(`${DRIZZLE_DIR}/${file}`, "utf8");
      expect(sql, file).not.toMatch(/diagnos/i);
    }
  });
});

describe("mastery-evidence rule (spec §6.3)", () => {
  const base = {
    studentId: "00000000-0000-4000-8000-000000000001",
    subject: "math.money",
    evidenceNote: "test evidence",
  };

  it("rejects a recalled answer claiming comprehension", () => {
    expect(() =>
      insertAssessmentSchema.parse({ ...base, level: "comprehension", evidenceKind: "recall" }),
    ).toThrow(/recall/i);
  });

  it("rejects a recalled answer claiming mastery", () => {
    expect(() =>
      insertAssessmentSchema.parse({ ...base, level: "mastery", evidenceKind: "recall" }),
    ).toThrow();
  });

  it("rejects application evidence claiming only memorization", () => {
    expect(() =>
      insertAssessmentSchema.parse({ ...base, level: "memorization", evidenceKind: "application" }),
    ).toThrow();
  });

  it("accepts recall for memorization and recognition", () => {
    for (const level of ["memorization", "recognition"] as const) {
      const parsed = insertAssessmentSchema.parse({
        ...base,
        level,
        evidenceKind: "recall",
      });
      expect(parsed.level).toBe(level);
    }
  });

  it("accepts independent application evidence for comprehension and above", () => {
    for (const level of ["comprehension", "application", "mastery"] as const) {
      for (const evidenceKind of ["application", "explanation", "transfer"] as const) {
        const parsed = insertAssessmentSchema.parse({ ...base, level, evidenceKind });
        expect(parsed.level).toBe(level);
        expect(parsed.evidenceKind).toBe(evidenceKind);
      }
    }
  });
});

/** Valid inserts for every table — the round-trip corpus. */
function fixtures() {
  const uuid = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const userId = uuid(1);
  const sessionId = uuid(2);
  const assessmentId = uuid(3);
  const turnId = uuid(4);

  return [
    {
      table: users,
      parse: insertUserSchema,
      value: {
        email: "student@example.com",
        passwordHash: "test-hash",
        role: "student" as const,
        displayName: "Sample Student",
      },
    },
    {
      table: guardianLinks,
      parse: insertGuardianLinkSchema,
      value: { parentId: userId, studentId: uuid(5), status: "granted" as const },
    },
    {
      table: consents,
      parse: insertConsentSchema,
      value: {
        guardianLinkId: uuid(6),
        type: "learning_data" as const,
        termsVersion: "v1.0",
      },
    },
    {
      table: learningProfiles,
      parse: insertLearningProfileSchema,
      value: { studentId: userId, subjects: ["math.money"], preferredStrategy: "visual" },
    },
    {
      table: profileEntries,
      parse: insertProfileEntrySchema,
      value: {
        profileId: uuid(7),
        kind: "strategy_change" as const,
        detail: "Switched to visual strategies",
        whyChanged: "Step-by-step attempts stalled",
        sourceAssessmentId: assessmentId,
        sourceTurnId: turnId,
      },
    },
    {
      table: tutoringSessions,
      parse: insertTutoringSessionSchema,
      value: { studentId: userId, title: "Money math", status: "active" as const },
    },
    {
      table: sessionTurns,
      parse: insertSessionTurnSchema,
      value: {
        sessionId,
        seq: 1,
        author: "tutor" as const,
        content: "Let's try a picture.",
        strategyId: "visual",
      },
    },
    {
      table: assessments,
      parse: insertAssessmentSchema,
      value: {
        studentId: userId,
        sessionId,
        turnId,
        subject: "math.money",
        skill: "making_change",
        level: "comprehension" as const,
        evidenceKind: "application" as const,
        evidenceNote: "Solved a novel change problem unaided",
      },
    },
    {
      table: progressEvents,
      parse: insertProgressEventSchema,
      value: {
        studentId: userId,
        kind: "assessment_recorded" as const,
        summary: "Comprehension evidenced",
      },
    },
    {
      table: accessibilityPrefs,
      parse: insertAccessibilityPrefsSchema,
      value: { userId, captionsEnabled: true, textSize: "large" as const },
    },
    {
      table: auditLog,
      parse: insertAuditLogSchema,
      value: {
        actorId: userId,
        action: "view_progress",
        resourceType: "learning_profiles",
        resourceId: uuid(7),
        decision: "allowed" as const,
        authorizationEvidence: { role: "parent", guardianLink: uuid(6) },
      },
    },
  ];
}

describe("insert-schema round-trip", () => {
  it("every table accepts a representative insert and preserves its fields", () => {
    for (const { table, parse, value } of fixtures()) {
      const parsed = parse.parse(value);
      for (const [key, expected] of Object.entries(value)) {
        expect(parsed, `${getTableName(table)}.${key}`).toEqual(
          expect.objectContaining({ [key]: expected }),
        );
      }
    }
  });

  it("server-managed fields (id, timestamps) stay optional in insert schemas", () => {
    const parsed = insertUserSchema.parse({
      email: "defaults@example.com",
      passwordHash: "test-hash",
      displayName: "Defaults",
    });
    expect(parsed.id).toBeUndefined();
    expect(parsed.createdAt).toBeUndefined();
  });
});

describe("generated migration carries the schema invariants", () => {
  it("includes the assessment evidence CHECK and other named constraints", () => {
    const allSql = migrationSqlFiles()
      .map((f) => readFileSync(`${DRIZZLE_DIR}/${f}`, "utf8"))
      .join("\n");
    expect(allSql).toMatch(/assessments_evidence_matches_level/);
    expect(allSql).toMatch(/guardian_links_not_self/);
    expect(allSql).toMatch(/accessibility_break_interval_range/);
    expect(allSql).toMatch(/session_turns_session_seq_unique/);
    expect(allSql).toMatch(/guardian_links_parent_student_unique/);
  });
});
