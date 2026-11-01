// Profile-evidence governance tests (spec §6.0) — the six named adversarial
// test classes, each a permanent test class:
//
//   1. Evidence belonging to another student → rejected, never attributed.
//   2. Nonexistent evidence IDs → rejected.
//   3. Valid evidence supporting an incorrect conclusion → rejected by the
//      pedagogical mapping (provenance alone does not pass).
//   4. Deleted or revoked evidence → hard delete refused while cited;
//      revocation invalidates dependent entries.
//   5. Duplicate or replayed profile updates → exactly one entry; the replay
//      returns the original.
//   6. Model-generated citations that do not resolve to real records →
//      rejected.
//
// The class suites run against an in-memory GovernanceStore (no database, they
// run everywhere); a second suite exercises the drizzle store and the RESTRICT
// foreign keys against a real PostgreSQL when one is configured.

import { sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  assessments,
  learningProfiles,
  profileEntries,
  sessionTurns,
  tutoringSessions,
  users,
  type Assessment,
  type ProfileEntry,
  type SessionTurn,
} from "@workspace/db/schema";
import type { CreateProfileEntryData } from "./entry-rules";
import {
  CitedEvidenceError,
  ProfileEvidenceError,
  UnlicensedInterpretationError,
  createGovernedProfileEntry,
  deleteEvidence,
  drizzleGovernanceStore,
  interpretationLicense,
  revokeEvidence,
  sameProposal,
  type GovernanceStore,
} from "./evidence-governance";

// ---------------------------------------------------------------------------
// In-memory GovernanceStore — the storage seam, faked; the rules are the real
// ones under test (createGovernedProfileEntry / revokeEvidence / deleteEvidence
// are the same functions production calls).
// ---------------------------------------------------------------------------

const NOW = new Date("2026-11-01T10:00:00.000Z");

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `00000000-0000-4000-8000-${idCounter.toString(16).padStart(12, "0")}`;
}

const STUDENT = "00000000-0000-4000-8000-000000000001";
const OTHER_STUDENT = "00000000-0000-4000-8000-000000000002";

interface MemoryData {
  profiles: Map<string, string>; // studentId -> profileId
  entries: ProfileEntry[];
  assessments: Map<string, Assessment>;
  turns: Map<string, SessionTurn>;
  /** Turn ownership runs through the owning session — the fake mirrors that. */
  turnOwners: Map<string, string>; // turnId -> studentId
}

function memoryStore(data: MemoryData = emptyData()): GovernanceStore {
  function ensureProfileId(studentId: string): string {
    let profileId = data.profiles.get(studentId);
    if (!profileId) {
      profileId = nextId();
      data.profiles.set(studentId, profileId);
    }
    return profileId;
  }

  return {
    async ensureProfileId(studentId) {
      return ensureProfileId(studentId);
    },
    // Existence and ownership fold into one lookup, mirroring the drizzle
    // store: a foreign row resolves as nothing at all.
    async resolveAssessment(studentId, assessmentId) {
      const row = data.assessments.get(assessmentId);
      return row && row.studentId === studentId ? row : undefined;
    },
    async resolveTurn(studentId, turnId) {
      const row = data.turns.get(turnId);
      return row && data.turnOwners.get(turnId) === studentId
        ? row
        : undefined;
    },
    async findReplay(profileId, input) {
      return data.entries.find(
        (entry) => entry.profileId === profileId && sameProposalEntry(entry, input),
      );
    },
    async insertEntry(profileId, input) {
      const entry = {
        id: nextId(),
        profileId,
        kind: input.kind,
        subject: input.subject ?? null,
        detail: input.detail,
        whyChanged: input.whyChanged ?? null,
        sourceAssessmentId: input.sourceAssessmentId ?? null,
        sourceTurnId: input.sourceTurnId ?? null,
        invalidatedAt: null,
        invalidatedReason: null,
        createdAt: NOW,
        updatedAt: NOW,
      } as ProfileEntry;
      data.entries.push(entry);
      return entry;
    },
    async findCitingEntries(ref) {
      return data.entries.filter((entry) =>
        ref.type === "assessment"
          ? entry.sourceAssessmentId === ref.id
          : entry.sourceTurnId === ref.id,
      );
    },
    async tombstoneAssessment(id, at) {
      const row = data.assessments.get(id);
      if (row) data.assessments.set(id, { ...row, revokedAt: at });
    },
    async tombstoneTurn(id, at) {
      const row = data.turns.get(id);
      if (row) data.turns.set(id, { ...row, revokedAt: at });
    },
    async invalidateEntries(ids, at, reason) {
      for (const entry of data.entries) {
        if (ids.includes(entry.id)) {
          data.entries[data.entries.indexOf(entry)] = {
            ...entry,
            invalidatedAt: at,
            invalidatedReason: reason,
            updatedAt: at,
          };
        }
      }
    },
    async hardDeleteAssessment(id) {
      data.assessments.delete(id);
    },
    async hardDeleteTurn(id) {
      data.turns.delete(id);
    },
    async getAssessment(id) {
      return data.assessments.get(id);
    },
    async getTurn(id) {
      return data.turns.get(id);
    },
  };
}

function emptyData(): MemoryData {
  return {
    profiles: new Map(),
    entries: [],
    assessments: new Map(),
    turns: new Map(),
    turnOwners: new Map(),
  };
}

/** Compare a stored entry against a proposal with null normalization. */
function sameProposalEntry(
  entry: ProfileEntry,
  input: CreateProfileEntryData,
): boolean {
  return sameProposal(
    {
      kind: entry.kind,
      subject: entry.subject ?? undefined,
      detail: entry.detail,
      whyChanged: entry.whyChanged ?? undefined,
      sourceAssessmentId: entry.sourceAssessmentId ?? undefined,
      sourceTurnId: entry.sourceTurnId ?? undefined,
    },
    input,
  );
}

// Fixtures: a recall-only assessment and an independent-application assessment
// for the primary student, plus one owned by the other student.
function seedAssessment(
  data: MemoryData,
  studentId: string,
  overrides: Partial<Assessment> = {},
): Assessment {
  const row = {
    id: nextId(),
    studentId,
    sessionId: null,
    turnId: null,
    subject: "math.money",
    skill: "making_change",
    level: "memorization" as const,
    evidenceKind: "recall" as const,
    evidenceNote: "Answered a practiced problem correctly from memory.",
    revokedAt: null,
    createdAt: NOW,
    ...overrides,
  } as Assessment;
  data.assessments.set(row.id, row);
  return row;
}

function seedTurn(data: MemoryData, studentId: string): SessionTurn {
  const turn: SessionTurn = {
    id: nextId(),
    sessionId: nextId(),
    seq: 1,
    author: "student",
    content: "I carried the wrong digit again — it keeps happening.",
    strategyId: null,
    revokedAt: null,
    createdAt: NOW,
  };
  data.turns.set(turn.id, turn);
  data.turnOwners.set(turn.id, studentId);
  return turn;
}

function governed(data: MemoryData): GovernanceStore {
  return memoryStore(data);
}

// ---------------------------------------------------------------------------
// Class suites (in-memory — run everywhere)
// ---------------------------------------------------------------------------

describe("adversarial class 1: evidence belonging to another student is rejected, never attributed", () => {
  it("rejects a gap citing an assessment owned by a different student", async () => {
    const data = emptyData();
    const foreign = seedAssessment(data, OTHER_STUDENT);
    const store = governed(data);

    await expect(
      createGovernedProfileEntry(store, STUDENT, {
        kind: "gap",
        subject: "math.money",
        detail: "Regrouping across zeros stalls.",
        sourceAssessmentId: foreign.id,
      }),
    ).rejects.toBeInstanceOf(ProfileEvidenceError);

    expect(data.entries).toHaveLength(0);
  });

  it("rejects a misconception citing another student's session turn", async () => {
    const data = emptyData();
    const foreignTurn = seedTurn(data, OTHER_STUDENT);
    const store = governed(data);

    await expect(
      createGovernedProfileEntry(store, STUDENT, {
        kind: "misconception",
        detail: "Carries the wrong digit.",
        sourceTurnId: foreignTurn.id,
      }),
    ).rejects.toBeInstanceOf(ProfileEvidenceError);

    expect(data.entries).toHaveLength(0);
  });

  it("does not leak that the foreign id exists — same rejection as a ghost id", async () => {
    const data = emptyData();
    const foreign = seedAssessment(data, OTHER_STUDENT);
    const ghost = nextId(); // well-formed, resolves to nothing
    const store = governed(data);

    let foreignMessage = "";
    try {
      await createGovernedProfileEntry(store, STUDENT, {
        kind: "gap",
        detail: "...",
        sourceAssessmentId: foreign.id,
      });
      expect.unreachable("foreign citation must throw");
    } catch (error) {
      foreignMessage = (error as Error).message;
    }
    let ghostMessage = "";
    try {
      await createGovernedProfileEntry(store, STUDENT, {
        kind: "gap",
        detail: "...",
        sourceAssessmentId: ghost,
      });
      expect.unreachable("ghost citation must throw");
    } catch (error) {
      ghostMessage = (error as Error).message;
    }
    expect(ghostMessage).toBe(foreignMessage);
  });
});

describe("adversarial class 2: nonexistent evidence IDs are rejected", () => {
  it("rejects a gap citing a well-formed assessment id that resolves to nothing", async () => {
    const data = emptyData();
    const store = governed(data);

    await expect(
      createGovernedProfileEntry(store, STUDENT, {
        kind: "gap",
        detail: "Regrouping stalls.",
        sourceAssessmentId: nextId(),
      }),
    ).rejects.toBeInstanceOf(ProfileEvidenceError);
    expect(data.entries).toHaveLength(0);
  });

  it("rejects a gap citing a well-formed turn id that resolves to nothing", async () => {
    const data = emptyData();
    const store = governed(data);

    await expect(
      createGovernedProfileEntry(store, STUDENT, {
        kind: "gap",
        detail: "Regrouping stalls.",
        sourceTurnId: nextId(),
      }),
    ).rejects.toBeInstanceOf(ProfileEvidenceError);
    expect(data.entries).toHaveLength(0);
  });
});

describe("adversarial class 3: valid evidence supporting an incorrect conclusion is rejected by the pedagogical mapping", () => {
  it("rejects a misconception standing on the student's own correct-recall assessment", async () => {
    // The evidence is real and owned — and it cannot license the conclusion:
    // an assessment is a correct demonstration, and a recall slip is not a
    // misconception (spec §6.0).
    const data = emptyData();
    const owned = seedAssessment(data, STUDENT, { evidenceKind: "recall", level: "memorization" });
    const store = governed(data);

    await expect(
      createGovernedProfileEntry(store, STUDENT, {
        kind: "misconception",
        detail: "Thinks multiplication repeats addition.",
        sourceAssessmentId: owned.id,
      }),
    ).rejects.toBeInstanceOf(UnlicensedInterpretationError);
    expect(data.entries).toHaveLength(0);
  });

  it("rejects a gap standing on the student's own independent-application success", async () => {
    const data = emptyData();
    const owned = seedAssessment(data, STUDENT, {
      evidenceKind: "application",
      level: "comprehension",
      evidenceNote: "Solved a problem unaided by applying the method.",
    });
    const store = governed(data);

    await expect(
      createGovernedProfileEntry(store, STUDENT, {
        kind: "gap",
        subject: "math.money",
        detail: "Regrouping across zeros stalls.",
        sourceAssessmentId: owned.id,
      }),
    ).rejects.toBeInstanceOf(UnlicensedInterpretationError);
    expect(data.entries).toHaveLength(0);
  });

  it("licenses the honest directions: recall evidence → gap, an observed turn → misconception", async () => {
    const data = emptyData();
    const recall = seedAssessment(data, STUDENT, { evidenceKind: "recall" });
    const turn = seedTurn(data, STUDENT);
    const store = governed(data);

    const gap = await createGovernedProfileEntry(store, STUDENT, {
      kind: "gap",
      subject: "math.money",
      detail: "The skill stops at recall — application not yet shown.",
      sourceAssessmentId: recall.id,
    });
    expect(gap.entry.kind).toBe("gap");
    expect(gap.replayed).toBe(false);

    const misconception = await createGovernedProfileEntry(store, STUDENT, {
      kind: "misconception",
      detail: "Carries the wrong digit when regrouping across zeros.",
      sourceTurnId: turn.id,
    });
    expect(misconception.entry.kind).toBe("misconception");
  });

  it("the mapping is a pure function — the license table holds without storage", () => {
    const recallAssessment = seedAssessment(emptyData(), STUDENT, { evidenceKind: "recall" });
    const applicationAssessment = seedAssessment(emptyData(), STUDENT, {
      evidenceKind: "transfer",
      level: "mastery",
    });

    expect(interpretationLicense("gap", { assessment: recallAssessment })).toEqual({
      licensed: true,
    });
    expect(
      interpretationLicense("gap", { assessment: applicationAssessment }).licensed,
    ).toBe(false);
    expect(
      interpretationLicense("misconception", { assessment: recallAssessment })
        .licensed,
    ).toBe(false);
  });
});

describe("adversarial class 4: deleted or revoked evidence — hard delete refused while cited; revocation invalidates dependent entries", () => {
  it("refuses to hard-delete a cited assessment and leaves the row intact", async () => {
    const data = emptyData();
    const assessment = seedAssessment(data, STUDENT, { evidenceKind: "recall" });
    const store = governed(data);
    await createGovernedProfileEntry(store, STUDENT, {
      kind: "gap",
      subject: "math.money",
      detail: "The skill stops at recall.",
      sourceAssessmentId: assessment.id,
    });

    await expect(
      deleteEvidence(store, { type: "assessment", id: assessment.id }),
    ).rejects.toBeInstanceOf(CitedEvidenceError);
    expect(data.assessments.has(assessment.id)).toBe(true);
  });

  it("refuses to hard-delete a cited turn, even when the citing entry is invalidated", async () => {
    const data = emptyData();
    const turn = seedTurn(data, STUDENT);
    const store = governed(data);
    await createGovernedProfileEntry(store, STUDENT, {
      kind: "misconception",
      detail: "Carries the wrong digit.",
      sourceTurnId: turn.id,
    });
    await revokeEvidence(store, { type: "turn", id: turn.id }, "observation withdrawn");

    // The entry survives revocation (marked invalid) and still holds its
    // citation for audit — so the delete stays refused.
    await expect(
      deleteEvidence(store, { type: "turn", id: turn.id }),
    ).rejects.toBeInstanceOf(CitedEvidenceError);
    expect(data.turns.has(turn.id)).toBe(true);
  });

  it("hard-deletes uncited evidence", async () => {
    const data = emptyData();
    const uncited = seedAssessment(data, STUDENT);
    const store = governed(data);

    await deleteEvidence(store, { type: "assessment", id: uncited.id });
    expect(data.assessments.has(uncited.id)).toBe(false);
  });

  it("revocation tombstones the evidence and invalidates the entries citing it with a reason that quotes the evidence", async () => {
    const data = emptyData();
    const assessment = seedAssessment(data, STUDENT, { evidenceKind: "recall" });
    const store = governed(data);
    const write = await createGovernedProfileEntry(store, STUDENT, {
      kind: "gap",
      subject: "math.money",
      detail: "The skill stops at recall.",
      sourceAssessmentId: assessment.id,
    });

    const result = await revokeEvidence(
      store,
      { type: "assessment", id: assessment.id },
      "the recorded observation was wrong",
    );
    expect(result.alreadyRevoked).toBe(false);
    expect(result.invalidatedEntryIds).toEqual([write.entry.id]);

    const tombstoned = data.assessments.get(assessment.id)!;
    expect(tombstoned.revokedAt).toBeInstanceOf(Date);
    // Soft tombstone: the row keeps its data for audit.
    expect(tombstoned.evidenceNote).toBe(assessment.evidenceNote);

    const invalidated = data.entries.find((e) => e.id === write.entry.id)!;
    expect(invalidated.invalidatedAt).toBeInstanceOf(Date);
    expect(invalidated.invalidatedReason).toContain(assessment.id);
    expect(invalidated.invalidatedReason).toContain("revoked");
  });

  it("invalidates every dependent entry, not just the first", async () => {
    const data = emptyData();
    const turn = seedTurn(data, STUDENT);
    const store = governed(data);
    const firstWrite = await createGovernedProfileEntry(store, STUDENT, {
      kind: "misconception",
      detail: "Carries the wrong digit.",
      sourceTurnId: turn.id,
    });
    const secondWrite = await createGovernedProfileEntry(store, STUDENT, {
      kind: "gap",
      detail: "Cannot yet explain the regrouping error.",
      sourceTurnId: turn.id,
    });

    const result = await revokeEvidence(
      store,
      { type: "turn", id: turn.id },
      "the turn was duplicated by a glitch",
    );
    expect(result.invalidatedEntryIds).toEqual([
      firstWrite.entry.id,
      secondWrite.entry.id,
    ]);
  });

  it("revocation is idempotent — a second revoke reports the original without double-invalidating", async () => {
    const data = emptyData();
    const assessment = seedAssessment(data, STUDENT);
    const store = governed(data);
    await createGovernedProfileEntry(store, STUDENT, {
      kind: "gap",
      detail: "Stops at recall.",
      sourceAssessmentId: assessment.id,
    });

    const first = await revokeEvidence(
      store,
      { type: "assessment", id: assessment.id },
      "reason one",
    );
    const second = await revokeEvidence(
      store,
      { type: "assessment", id: assessment.id },
      "reason two",
    );
    expect(second.alreadyRevoked).toBe(true);
    expect(second.invalidatedEntryIds).toEqual([]);
    expect(data.entries[0]?.invalidatedReason).toContain("reason one");
  });

  it("a new entry citing revoked evidence is rejected — dead evidence licenses nothing", async () => {
    const data = emptyData();
    const assessment = seedAssessment(data, STUDENT);
    const store = governed(data);
    await revokeEvidence(
      store,
      { type: "assessment", id: assessment.id },
      "observation withdrawn",
    );

    await expect(
      createGovernedProfileEntry(store, STUDENT, {
        kind: "gap",
        detail: "A fresh gap claim on revoked evidence.",
        sourceAssessmentId: assessment.id,
      }),
    ).rejects.toBeInstanceOf(UnlicensedInterpretationError);
    expect(data.entries).toHaveLength(0);
  });
});

describe("adversarial class 5: duplicate or replayed profile updates dedupe to one entry; the replay returns the original", () => {
  const proposal: CreateProfileEntryData = {
    kind: "gap",
    subject: "math.money",
    detail: "Regrouping across zeros stalls.",
    sourceAssessmentId: undefined,
    sourceTurnId: undefined,
  };

  it("returns the original entry and writes no second row", async () => {
    const data = emptyData();
    const store = governed(data);

    const first = await createGovernedProfileEntry(store, STUDENT, proposal);
    const replay = await createGovernedProfileEntry(store, STUDENT, proposal);

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.entry.id).toBe(first.entry.id);
    expect(data.entries).toHaveLength(1);
  });

  it("dedupes a proposal citing evidence — same student, same citations, same conclusion", async () => {
    const data = emptyData();
    const assessment = seedAssessment(data, STUDENT);
    const store = governed(data);
    const citing = { ...proposal, sourceAssessmentId: assessment.id };

    const first = await createGovernedProfileEntry(store, STUDENT, citing);
    const replay = await createGovernedProfileEntry(store, STUDENT, citing);

    expect(replay.replayed).toBe(true);
    expect(replay.entry.id).toBe(first.entry.id);
    expect(data.entries).toHaveLength(1);
  });

  it("does not dedupe a materially different proposal", async () => {
    const data = emptyData();
    const store = governed(data);

    await createGovernedProfileEntry(store, STUDENT, proposal);
    const second = await createGovernedProfileEntry(store, STUDENT, {
      ...proposal,
      detail: "Regrouping across zeros stalls even with manipulatives.",
    });

    expect(second.replayed).toBe(false);
    expect(data.entries).toHaveLength(2);
  });

  it("replays stay per-student — the same proposal from two students writes two entries", async () => {
    const data = emptyData();
    const store = governed(data);

    const a = await createGovernedProfileEntry(store, STUDENT, proposal);
    const b = await createGovernedProfileEntry(store, OTHER_STUDENT, proposal);

    expect(b.replayed).toBe(false);
    expect(b.entry.id).not.toBe(a.entry.id);
    expect(data.entries).toHaveLength(2);
  });
});

describe("adversarial class 6: model-generated citations that do not resolve to real records are rejected", () => {
  it("rejects a plausible fabricated assessment id — never partially accepted, never logged as an entry", async () => {
    const data = emptyData();
    const store = governed(data);
    // A model-voiced proposal with confident-sounding citations that resolve
    // to no record at all.
    const fabricated: CreateProfileEntryData = {
      kind: "misconception",
      detail: "After the worksheet, the student consistently confuses area and perimeter.",
      sourceAssessmentId: nextId(),
    };

    await expect(
      createGovernedProfileEntry(store, STUDENT, fabricated),
    ).rejects.toBeInstanceOf(ProfileEvidenceError);
    expect(data.entries).toHaveLength(0);
  });

  it("rejects a fabricated turn citation", async () => {
    const data = emptyData();
    const store = governed(data);

    await expect(
      createGovernedProfileEntry(store, STUDENT, {
        kind: "gap",
        detail: "Stalls on multi-step problems.",
        sourceTurnId: nextId(),
      }),
    ).rejects.toBeInstanceOf(ProfileEvidenceError);
    expect(data.entries).toHaveLength(0);
  });

  it("a proposal mixing one real citation and one fabricated citation is rejected whole", async () => {
    const data = emptyData();
    const real = seedAssessment(data, STUDENT);
    const store = governed(data);

    await expect(
      createGovernedProfileEntry(store, STUDENT, {
        kind: "gap",
        detail: "Stops at recall.",
        sourceAssessmentId: real.id,
        sourceTurnId: nextId(),
      }),
    ).rejects.toBeInstanceOf(ProfileEvidenceError);
    expect(data.entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Drizzle store + RESTRICT foreign keys against a real PostgreSQL.
// Runs when PROFILE_EVIDENCE_TEST_DATABASE_URL (or AUTH_TEST_DATABASE_URL) is
// set; `pnpm -r test` stays green without a database.
// ---------------------------------------------------------------------------

const TEST_DATABASE_URL =
  process.env.PROFILE_EVIDENCE_TEST_DATABASE_URL ??
  process.env.AUTH_TEST_DATABASE_URL;

async function expectPgCode(
  run: () => Promise<unknown>,
  code: "23503" | "23001",
) {
  try {
    await run();
  } catch (error) {
    const candidates = [
      error as { code?: string } | undefined,
      (error as { cause?: { code?: string } }).cause,
    ];
    if (candidates.some((candidate) => candidate?.code === code)) return;
    throw error;
  }
  throw new Error(`expected PostgreSQL error ${code}, but the statement succeeded`);
}

describe.skipIf(!TEST_DATABASE_URL)(
  "evidence governance against a real PostgreSQL (drizzle store + RESTRICT FKs)",
  () => {
    let pool: Pool | undefined;
    let db: NodePgDatabase | undefined;
    let emailCounter = 0;

    beforeAll(async () => {
      const pg = (await import("pg")).default;
      const { drizzle } = await import("drizzle-orm/node-postgres");
      const { migrate } = await import("drizzle-orm/node-postgres/migrator");
      pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
      db = drizzle(pool);
      await migrate(db, {
        migrationsFolder: fileURLToPath(
          new URL("../../../../lib/db/drizzle", import.meta.url),
        ),
      });
    }, 30_000);

    afterAll(async () => {
      await pool?.end();
    });

    beforeEach(async () => {
      await db!.execute(
        sql`TRUNCATE TABLE ${sql.join(
          [profileEntries, assessments, sessionTurns, tutoringSessions, learningProfiles, users],
          sql`, `,
        )} CASCADE`,
      );
    });

    async function insertStudent(): Promise<string> {
      emailCounter += 1;
      const email = `gov-student-${emailCounter}@primer.test`;
      const [row] = await db!
        .insert(users)
        .values({ email, passwordHash: "test-hash", role: "student", displayName: email })
        .returning();
      return row.id;
    }

    async function insertOwnedAssessment(
      studentId: string,
      overrides: Partial<Assessment> = {},
    ): Promise<Assessment> {
      const [row] = await db!
        .insert(assessments)
        .values({
          studentId,
          subject: "math.money",
          skill: "making_change",
          level: "memorization",
          evidenceKind: "recall",
          evidenceNote: "Answered a practiced problem correctly from memory.",
          ...overrides,
        })
        .returning();
      return row;
    }

    async function insertOwnedTurn(studentId: string): Promise<SessionTurn> {
      const [session] = await db!
        .insert(tutoringSessions)
        .values({ studentId })
        .returning();
      const [turn] = await db!
        .insert(sessionTurns)
        .values({ sessionId: session.id, seq: 1, author: "student", content: "I keep carrying the wrong digit." })
        .returning();
      return turn;
    }

    it("class 1 + 2: the drizzle store rejects foreign and nonexistent citations identically", async () => {
      const student = await insertStudent();
      const other = await insertStudent();
      const foreign = await insertOwnedAssessment(other);
      const store = drizzleGovernanceStore(db!);

      await expect(
        createGovernedProfileEntry(store, student, {
          kind: "gap",
          detail: "Regrouping stalls.",
          sourceAssessmentId: foreign.id,
        }),
      ).rejects.toBeInstanceOf(ProfileEvidenceError);

      await expect(
        createGovernedProfileEntry(store, student, {
          kind: "gap",
          detail: "Regrouping stalls.",
          sourceAssessmentId: "00000000-0000-4000-8000-0000000000ff",
        }),
      ).rejects.toBeInstanceOf(ProfileEvidenceError);

      const entries = await db!.select().from(profileEntries);
      expect(entries).toHaveLength(0);
    });

    it("class 3: the drizzle store rejects an unlicensed interpretation", async () => {
      const student = await insertStudent();
      const owned = await insertOwnedAssessment(student, {
        evidenceKind: "application",
        level: "comprehension",
        evidenceNote: "Solved a problem unaided by applying the method.",
      });

      await expect(
        createGovernedProfileEntry(drizzleGovernanceStore(db!), student, {
          kind: "gap",
          detail: "Regrouping stalls.",
          sourceAssessmentId: owned.id,
        }),
      ).rejects.toBeInstanceOf(UnlicensedInterpretationError);
    });

    it("class 4: the database itself refuses to hard-delete cited evidence (RESTRICT FK)", async () => {
      const student = await insertStudent();
      const assessment = await insertOwnedAssessment(student);
      const store = drizzleGovernanceStore(db!);

      await createGovernedProfileEntry(store, student, {
        kind: "gap",
        detail: "The skill stops at recall.",
        sourceAssessmentId: assessment.id,
      });

      // The service refuses first; even bypassing it, the FK holds the line.
      await expect(
        deleteEvidence(store, { type: "assessment", id: assessment.id }),
      ).rejects.toBeInstanceOf(CitedEvidenceError);
      await expectPgCode(
        () => db!.delete(assessments).where(sql`id = ${assessment.id}`),
        "23001",
      );

      const [stillThere] = await db!
        .select()
        .from(assessments)
        .where(sql`id = ${assessment.id}`);
      expect(stillThere).toBeDefined();
      // The entry's citation was never ghosted.
      const [entry] = await db!.select().from(profileEntries);
      expect(entry?.sourceAssessmentId).toBe(assessment.id);
    });

    it("class 4: revocation tombstones the row and invalidates the citing entry in PostgreSQL", async () => {
      const student = await insertStudent();
      const turn = await insertOwnedTurn(student);
      const store = drizzleGovernanceStore(db!);

      const write = await createGovernedProfileEntry(store, student, {
        kind: "misconception",
        detail: "Carries the wrong digit.",
        sourceTurnId: turn.id,
      });

      const result = await revokeEvidence(
        store,
        { type: "turn", id: turn.id },
        "the recorded observation was wrong",
      );
      expect(result.invalidatedEntryIds).toEqual([write.entry.id]);

      const [invalidated] = await db!
        .select()
        .from(profileEntries)
        .where(sql`id = ${write.entry.id}`);
      expect(invalidated?.invalidatedAt).toBeInstanceOf(Date);
      expect(invalidated?.invalidatedReason).toContain(turn.id);

      // And the database blocks a hard delete of the tombstoned evidence —
      // the citation survives, marked invalid, never dangling.
      await expectPgCode(
        () => db!.delete(sessionTurns).where(sql`id = ${turn.id}`),
        "23001",
      );
    });

    it("class 5: replayed proposals return the original row", async () => {
      const student = await insertStudent();
      const assessment = await insertOwnedAssessment(student);
      const store = drizzleGovernanceStore(db!);
      const proposal = {
        kind: "gap" as const,
        subject: "math.money",
        detail: "The skill stops at recall.",
        sourceAssessmentId: assessment.id,
      };

      const first = await createGovernedProfileEntry(store, student, proposal);
      const replay = await createGovernedProfileEntry(store, student, proposal);

      expect(replay.replayed).toBe(true);
      expect(replay.entry.id).toBe(first.entry.id);
      const rows = await db!.select().from(profileEntries);
      expect(rows).toHaveLength(1);
    });

    it("class 6: a fabricated citation is rejected at the store boundary", async () => {
      const student = await insertStudent();
      await expect(
        createGovernedProfileEntry(drizzleGovernanceStore(db!), student, {
          kind: "misconception",
          detail: "A confident-sounding fabrication.",
          sourceTurnId: "00000000-0000-4000-8000-0000000000fe",
        }),
      ).rejects.toBeInstanceOf(ProfileEvidenceError);
    });
  },
);
