import { and, eq, inArray, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  assessments,
  learningProfiles,
  profileEntries,
  sessionTurns,
  tutoringSessions,
  type Assessment,
  type ProfileEntry,
  type SessionTurn,
} from "@workspace/db/schema";
import type { CreateProfileEntryData } from "./entry-rules";

/**
 * Profile-evidence governance (spec §6.0) — the two layers that make a child's
 * learning record earned, never invented:
 *
 * 1. Provenance verification: every cited evidence reference must resolve to a
 *    real record that belongs to the citing student. A citation that does not
 *    resolve is rejected outright — never partially accepted.
 * 2. Pedagogical validation: real evidence still does not license any
 *    conclusion. Each entry kind is licensed only by admissible evidence kinds
 *    (the mapping below), so a correct answer can never be stood up as a
 *    misconception and demonstrated mastery cannot be cited as a gap.
 *
 * Lifecycle rules on top: cited evidence cannot be hard-deleted (the database
 * FK is RESTRICT and the service refuses first), evidence can be revoked as a
 * soft tombstone, revocation invalidates dependent entries, and an identical
 * proposal replays to the original entry instead of writing a second one.
 *
 * The storage seam is `GovernanceStore` (drizzle in production, in-memory in
 * tests); the rules themselves are pure and shared by both.
 */

/** A create input cited evidence that does not exist for this student. */
export class ProfileEvidenceError extends Error {
  constructor(
    message: string,
    readonly field: "sourceAssessmentId" | "sourceTurnId",
  ) {
    super(message);
    this.name = "ProfileEvidenceError";
  }
}

/**
 * Real, owned evidence that does not license the proposed conclusion
 * (spec §6.0 layer 2). Provenance passing is never enough on its own.
 */
export class UnlicensedInterpretationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnlicensedInterpretationError";
  }
}

/** Hard-deleting evidence a profile entry still cites is refused (spec §6.0). */
export class CitedEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CitedEvidenceError";
  }
}

/** The evidence row a revocation or deletion names does not exist. */
export class EvidenceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceNotFoundError";
  }
}

/** Which evidence a profile entry cites. */
export type EvidenceRef =
  | { type: "assessment"; id: string }
  | { type: "turn"; id: string };

/**
 * The pedagogical mapping (spec §6.0 layer 2): which evidence kind licenses
 * which conclusion.
 *
 * - An assessment row is always a *positive demonstration* — the mastery
 *   classifier never writes failed attempts (`classifyMastery` returns null
 *   for them). A correct answer is at most recall evidence, and the spec is
 *   explicit that a recall slip or single miss is not a misconception. So no
 *   assessment can ever license a `misconception`; the wrong answer has to be
 *   visible in the cited session turn.
 * - `recall` assessments (answered a practiced problem correctly from memory
 *   or by recognition) honestly support a `gap`: the skill demonstrably stops
 *   at recall (spec §6.3). Independent-application evidence (application,
 *   explanation, transfer — comprehension and above) is success evidence and
 *   cannot be cited as a gap.
 * - Revoked evidence licenses nothing new: its entries were already
 *   invalidated, and a new entry on dead evidence would be a fresh dangling
 *   interpretation.
 * - `successful_approach`, `preference`, and `strategy_change` carry their own
 *   justification (the observation note, the self-declaration, the
 *   `whyChanged` transparency note), so any live evidence they cite is
 *   admissible.
 */
export function interpretationLicense(
  entryKind: ProfileEntry["kind"],
  evidence: { assessment?: Assessment; turn?: SessionTurn },
): { licensed: true } | { licensed: false; reason: string } {
  const { assessment, turn } = evidence;

  if ((assessment?.revokedAt ?? null) !== null) {
    return {
      licensed: false,
      reason:
        "The cited assessment was revoked — revoked evidence licenses no new interpretation (spec §6.0).",
    };
  }
  if ((turn?.revokedAt ?? null) !== null) {
    return {
      licensed: false,
      reason:
        "The cited session turn was revoked — revoked evidence licenses no new interpretation (spec §6.0).",
    };
  }

  switch (entryKind) {
    case "misconception":
      if (assessment) {
        return {
          licensed: false,
          reason:
            "An assessment records a correct demonstration — a recall slip or single miss is not a misconception " +
            "(spec §6.0). Cite the session turn where the error pattern shows.",
        };
      }
      return { licensed: true };
    case "gap":
      if (assessment && assessment.evidenceKind !== "recall") {
        return {
          licensed: false,
          reason:
            `The cited assessment demonstrates independent ${assessment.evidenceKind} — ` +
            "evidence of successful application cannot establish a gap (spec §6.0).",
        };
      }
      return { licensed: true };
    case "successful_approach":
    case "preference":
    case "strategy_change":
      return { licensed: true };
  }
}

/** Undefined and null mean the same written value (an absent column). */
function norm(value: string | null | undefined): string | null {
  return value ?? null;
}

/**
 * The replay identity of a profile-update proposal (spec §6.0): same student,
 * same citations, same conclusion. Two proposals that agree on every field are
 * one proposal — the second replay returns the first entry.
 */
export function sameProposal(
  a: CreateProfileEntryData,
  b: CreateProfileEntryData,
): boolean {
  return (
    a.kind === b.kind &&
    norm(a.subject) === norm(b.subject) &&
    a.detail === b.detail &&
    norm(a.whyChanged) === norm(b.whyChanged) &&
    norm(a.sourceAssessmentId) === norm(b.sourceAssessmentId) &&
    norm(a.sourceTurnId) === norm(b.sourceTurnId)
  );
}

/** Compose the auditable invalidation reason: it quotes its evidence. */
export function invalidationReason(ref: EvidenceRef, reason: string): string {
  return (
    `The ${ref.type} this entry cites (${ref.id}) was revoked: ${reason} ` +
    "Entries citing revoked evidence are invalidated, never silently dangling (spec §6.0)."
  );
}

/**
 * The storage seam for the governance flows — drizzle in production, an
 * in-memory fake in tests. Queries fold existence and ownership into one
 * lookup: a row that exists but belongs to another student resolves as
 * nothing at all (the rejection must not leak that the id exists).
 */
export interface GovernanceStore {
  /** Find-or-create the one profile per student; returns its id. */
  ensureProfileId(studentId: string): Promise<string>;
  resolveAssessment(
    studentId: string,
    assessmentId: string,
  ): Promise<Assessment | undefined>;
  resolveTurn(studentId: string, turnId: string): Promise<SessionTurn | undefined>;
  findReplay(
    profileId: string,
    input: CreateProfileEntryData,
  ): Promise<ProfileEntry | undefined>;
  insertEntry(profileId: string, input: CreateProfileEntryData): Promise<ProfileEntry>;
  findCitingEntries(ref: EvidenceRef): Promise<ProfileEntry[]>;
  tombstoneAssessment(id: string, at: Date, reason: string): Promise<void>;
  tombstoneTurn(id: string, at: Date, reason: string): Promise<void>;
  invalidateEntries(ids: string[], at: Date, reason: string): Promise<void>;
  hardDeleteAssessment(id: string): Promise<void>;
  hardDeleteTurn(id: string): Promise<void>;
  getAssessment(id: string): Promise<Assessment | undefined>;
  getTurn(id: string): Promise<SessionTurn | undefined>;
}

/** What a governed write produced: a fresh row, or the original on replay. */
export interface GovernedProfileEntryWrite {
  entry: ProfileEntry;
  /** True when the proposal was an identical replay — nothing was written. */
  replayed: boolean;
}

/**
 * The governed create path. Every write into the learning record passes
 * through, in order: provenance (resolve to real, owned records), pedagogical
 * validation (the conclusion is licensed by the evidence's kind), replay
 * dedupe (identical proposals return the original), insert.
 */
export async function createGovernedProfileEntry(
  store: GovernanceStore,
  studentId: string,
  input: CreateProfileEntryData,
): Promise<GovernedProfileEntryWrite> {
  // Layer 1 — provenance. A provided id must resolve to a record the student
  // owns; a foreign id and a fabricated id are the same rejection.
  const assessment = input.sourceAssessmentId
    ? await store.resolveAssessment(studentId, input.sourceAssessmentId)
    : undefined;
  if (input.sourceAssessmentId && !assessment) {
    throw new ProfileEvidenceError(
      "The referenced assessment does not exist for this student.",
      "sourceAssessmentId",
    );
  }
  const turn = input.sourceTurnId
    ? await store.resolveTurn(studentId, input.sourceTurnId)
    : undefined;
  if (input.sourceTurnId && !turn) {
    throw new ProfileEvidenceError(
      "The referenced session turn does not exist for this student.",
      "sourceTurnId",
    );
  }

  // Layer 2 — pedagogical validation. Provenance proves the evidence is real;
  // it does not prove the interpretation correct.
  const license = interpretationLicense(input.kind, { assessment, turn });
  if (!license.licensed) {
    throw new UnlicensedInterpretationError(license.reason);
  }

  // Replay dedupe: an identical proposal returns the original entry — exactly
  // one row per (student, citations, conclusion), the replay never a second.
  const profileId = await store.ensureProfileId(studentId);
  const replay = await store.findReplay(profileId, input);
  if (replay) return { entry: replay, replayed: true };

  return { entry: await store.insertEntry(profileId, input), replayed: false };
}

export interface RevocationResult {
  /** The tombstoned evidence row (read back after the write). */
  evidence: Assessment | SessionTurn;
  /** Entries invalidated by this revocation, already citing it. */
  invalidatedEntryIds: string[];
  alreadyRevoked: boolean;
}

/**
 * Revoke evidence as a soft tombstone (spec §6.0): the row keeps its data for
 * audit, gains `revokedAt`, and every profile entry citing it is invalidated
 * with a reason that quotes the evidence — an entry never survives on a
 * silent, dangling citation. Idempotent: revoking twice reports the original.
 */
export async function revokeEvidence(
  store: GovernanceStore,
  ref: EvidenceRef,
  reason: string,
  at: Date = new Date(),
): Promise<RevocationResult> {
  if (ref.type === "assessment") {
    const existing = await store.getAssessment(ref.id);
    if (!existing) throw new EvidenceNotFoundError("No such assessment exists.");
    if (existing.revokedAt) {
      return { evidence: existing, invalidatedEntryIds: [], alreadyRevoked: true };
    }
    await store.tombstoneAssessment(ref.id, at, reason);
  } else {
    const existing = await store.getTurn(ref.id);
    if (!existing) throw new EvidenceNotFoundError("No such session turn exists.");
    if (existing.revokedAt) {
      return { evidence: existing, invalidatedEntryIds: [], alreadyRevoked: true };
    }
    await store.tombstoneTurn(ref.id, at, reason);
  }

  const citing = await store.findCitingEntries(ref);
  const toInvalidate = citing
    .filter((entry) => entry.invalidatedAt === null)
    .map((entry) => entry.id);
  if (toInvalidate.length > 0) {
    await store.invalidateEntries(
      toInvalidate,
      at,
      invalidationReason(ref, reason),
    );
  }

  const evidence =
    ref.type === "assessment"
      ? await store.getAssessment(ref.id)
      : await store.getTurn(ref.id);
  if (!evidence) throw new EvidenceNotFoundError("Evidence vanished mid-revocation.");
  return { evidence, invalidatedEntryIds: toInvalidate, alreadyRevoked: false };
}

/**
 * The hard-delete gate (spec §6.0): evidence a profile entry still cites
 * cannot be hard-deleted — the tombstone path (`revokeEvidence`) is the
 * sanctioned removal. Uncited evidence deletes outright. Even invalidated
 * entries hold their citation for audit, so any citation at all blocks the
 * delete; the database RESTRICT FK is the second line of defense.
 */
export async function deleteEvidence(
  store: GovernanceStore,
  ref: EvidenceRef,
): Promise<{ deleted: true }> {
  const citing = await store.findCitingEntries(ref);
  if (citing.length > 0) {
    throw new CitedEvidenceError(
      `This ${ref.type} is cited by ${citing.length} profile ` +
        `${citing.length === 1 ? "entry" : "entries"} and cannot be hard-deleted ` +
        "(spec §6.0). Revoke it instead — the tombstone keeps the record auditable.",
    );
  }
  if (ref.type === "assessment") {
    await store.hardDeleteAssessment(ref.id);
  } else {
    await store.hardDeleteTurn(ref.id);
  }
  return { deleted: true };
}

/** The drizzle implementation of the governance store. */
export function drizzleGovernanceStore(db: NodePgDatabase): GovernanceStore {
  return {
    async ensureProfileId(studentId) {
      const [existing] = await db
        .select({ id: learningProfiles.id })
        .from(learningProfiles)
        .where(eq(learningProfiles.studentId, studentId))
        .limit(1);
      if (existing) return existing.id;

      // onConflictDoNothing: a concurrent ensure must not throw on the unique
      // constraint — the winner's row is simply re-read (same pattern as
      // ensureProfile).
      const [created] = await db
        .insert(learningProfiles)
        .values({ studentId })
        .onConflictDoNothing()
        .returning({ id: learningProfiles.id });
      if (created) return created.id;

      const [raced] = await db
        .select({ id: learningProfiles.id })
        .from(learningProfiles)
        .where(eq(learningProfiles.studentId, studentId))
        .limit(1);
      if (!raced) throw new Error("learning profile could not be ensured");
      return raced.id;
    },

    // Existence and ownership fold into one lookup: a foreign row resolves as
    // nothing, so the rejection never leaks that the id exists.
    async resolveAssessment(studentId, assessmentId) {
      const [row] = await db
        .select()
        .from(assessments)
        .where(
          and(
            eq(assessments.id, assessmentId),
            eq(assessments.studentId, studentId),
          ),
        )
        .limit(1);
      return row;
    },

    // Turn ownership runs through the session — a turn belongs to the student
    // whose session it sits in.
    async resolveTurn(studentId, turnId) {
      const [row] = await db
        .select({ turn: sessionTurns })
        .from(sessionTurns)
        .innerJoin(
          tutoringSessions,
          eq(sessionTurns.sessionId, tutoringSessions.id),
        )
        .where(
          and(
            eq(sessionTurns.id, turnId),
            eq(tutoringSessions.studentId, studentId),
          ),
        )
        .limit(1);
      return row?.turn;
    },

    // Exact-proposal replay match: every proposal field equals the stored
    // column, with undefined meaning null (IS NULL) for absent values.
    async findReplay(profileId, input) {
      const conditions = [
        eq(profileEntries.profileId, profileId),
        eq(profileEntries.kind, input.kind),
        eq(profileEntries.detail, input.detail),
        input.subject === undefined
          ? isNull(profileEntries.subject)
          : eq(profileEntries.subject, input.subject),
        input.whyChanged === undefined
          ? isNull(profileEntries.whyChanged)
          : eq(profileEntries.whyChanged, input.whyChanged),
        input.sourceAssessmentId === undefined
          ? isNull(profileEntries.sourceAssessmentId)
          : eq(profileEntries.sourceAssessmentId, input.sourceAssessmentId),
        input.sourceTurnId === undefined
          ? isNull(profileEntries.sourceTurnId)
          : eq(profileEntries.sourceTurnId, input.sourceTurnId),
      ];
      const [row] = await db
        .select()
        .from(profileEntries)
        .where(and(...conditions))
        .limit(1);
      return row;
    },

    async insertEntry(profileId, input) {
      const [entry] = await db
        .insert(profileEntries)
        .values({
          profileId,
          kind: input.kind,
          subject: input.subject,
          detail: input.detail,
          whyChanged: input.whyChanged,
          sourceAssessmentId: input.sourceAssessmentId,
          sourceTurnId: input.sourceTurnId,
        })
        .returning();
      return entry;
    },

    async findCitingEntries(ref) {
      const citation =
        ref.type === "assessment"
          ? profileEntries.sourceAssessmentId
          : profileEntries.sourceTurnId;
      return db
        .select()
        .from(profileEntries)
        .where(eq(citation, ref.id));
    },

    async tombstoneAssessment(id, at, _reason) {
      // The reason lives on the invalidated entries (quoting this evidence);
      // the tombstone itself is the revokedAt mark.
      void _reason;
      await db
        .update(assessments)
        .set({ revokedAt: at })
        .where(and(eq(assessments.id, id), isNull(assessments.revokedAt)));
    },

    async tombstoneTurn(id, at, _reason) {
      void _reason;
      await db
        .update(sessionTurns)
        .set({ revokedAt: at })
        .where(and(eq(sessionTurns.id, id), isNull(sessionTurns.revokedAt)));
    },

    async invalidateEntries(ids, at, reason) {
      await db
        .update(profileEntries)
        .set({ invalidatedAt: at, invalidatedReason: reason, updatedAt: at })
        .where(inArray(profileEntries.id, ids));
    },

    async hardDeleteAssessment(id) {
      await db.delete(assessments).where(eq(assessments.id, id));
    },

    async hardDeleteTurn(id) {
      await db.delete(sessionTurns).where(eq(sessionTurns.id, id));
    },

    async getAssessment(id) {
      const [row] = await db
        .select()
        .from(assessments)
        .where(eq(assessments.id, id))
        .limit(1);
      return row;
    },

    async getTurn(id) {
      const [row] = await db
        .select()
        .from(sessionTurns)
        .where(eq(sessionTurns.id, id))
        .limit(1);
      return row;
    },
  };
}
