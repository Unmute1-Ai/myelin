import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  learningProfiles,
  profileEntries,
  users,
  type LearningProfile,
  type ProfileEntry,
} from "@workspace/db/schema";
import type { CreateProfileEntryData } from "./entry-rules";
import {
  // Re-exported for the routes, which map these to contract error codes at
  // the boundary (ProfileEvidenceError → 400).
  ProfileEvidenceError,
  UnlicensedInterpretationError,
  createGovernedProfileEntry,
  drizzleGovernanceStore,
  type GovernedProfileEntryWrite,
} from "./evidence-governance";

export { ProfileEvidenceError, UnlicensedInterpretationError };

/**
 * The learning-profile service (spec §6.2): persistence and evidence rules
 * behind the profile routes. The authorization boundary (who may read or
 * write) lives in `authorize()` at the route layer; this layer owns what a
 * write may contain. Every entry write passes through the evidence-governance
 * flow (spec §6.0): provenance (citations resolve to real, owned records),
 * pedagogical validation (the conclusion is licensed by the evidence kind),
 * and replay dedupe (identical proposals return the original entry).
 */

/** The path user does not exist or is not a student (contract 404). */
export class StudentNotFoundError extends Error {
  constructor(message = "No student profile exists here.") {
    super(message);
    this.name = "StudentNotFoundError";
  }
}

/**
 * Find-or-create the one profile per student. Registration does not pre-create
 * profiles, so the first read establishes the row — a student's dashboard is
 * never dead, and every later consumer (adaptive engine, dashboards) can rely
 * on the invariant "every student has a profile".
 */
export async function ensureProfile(
  db: NodePgDatabase,
  studentId: string,
): Promise<LearningProfile> {
  const [existing] = await db
    .select()
    .from(learningProfiles)
    .where(eq(learningProfiles.studentId, studentId))
    .limit(1);
  if (existing) return existing;

  // onConflictDoNothing: a concurrent ensure for the same student must not
  // throw on the unique constraint — the winner's row is simply re-read.
  const [created] = await db
    .insert(learningProfiles)
    .values({ studentId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [raced] = await db
    .select()
    .from(learningProfiles)
    .where(eq(learningProfiles.studentId, studentId))
    .limit(1);
  if (!raced) throw new Error("learning profile could not be ensured");
  return raced;
}

/** The profile routes 404 for paths that are not a live student account. */
export async function studentExists(
  db: NodePgDatabase,
  studentId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, studentId), eq(users.role, "student")))
    .limit(1);
  return row !== undefined;
}

export async function createProfileEntry(
  db: NodePgDatabase,
  studentId: string,
  input: CreateProfileEntryData,
): Promise<GovernedProfileEntryWrite> {
  // The governed write path (spec §6.0): provenance → pedagogical license →
  // replay dedupe → insert. Throws ProfileEvidenceError for an unresolvable
  // citation and UnlicensedInterpretationError for a conclusion the evidence
  // kind does not support. `replayed` distinguishes a fresh write from a
  // deduped replay so callers can respond with the right status.
  return createGovernedProfileEntry(
    drizzleGovernanceStore(db),
    studentId,
    input,
  );
}

/** The explicit-only fields a PATCH may change; only provided keys move. */
export type ProfilePatch = Partial<
  Pick<LearningProfile, "subjects" | "preferredStrategy" | "pacing">
>;

/** Apply the student's explicit choices to their profile. */
export async function updateProfile(
  db: NodePgDatabase,
  studentId: string,
  patch: ProfilePatch,
): Promise<LearningProfile> {
  const profile = await ensureProfile(db, studentId);
  const [updated] = await db
    .update(learningProfiles)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(learningProfiles.id, profile.id))
    .returning();
  return updated;
}

/**
 * The profile data layer the routes consume — a port in the auth-deps style:
 * drizzle in production, an in-memory fake in route tests. The service
 * functions above are the drizzle implementation's internals.
 *
 * Contract for every implementation, including test fakes: `createProfileEntry`
 * runs the governed write path (spec §6.0) — citations must resolve to records
 * the student owns (ProfileEvidenceError otherwise), the conclusion must be
 * licensed by the evidence kind (UnlicensedInterpretationError otherwise), and
 * an identical replay returns the original entry with `replayed: true` instead
 * of writing a second row. The pure rules it composes live in
 * evidence-governance.ts.
 */
export interface ProfileDataPort {
  /** The path user does not exist or is not a student (contract 404). */
  studentExists(studentId: string): Promise<boolean>;
  /** Find-or-create the student's profile (registration does not pre-create). */
  ensureProfile(studentId: string): Promise<LearningProfile>;
  updateProfile(
    studentId: string,
    patch: ProfilePatch,
  ): Promise<LearningProfile>;
  createProfileEntry(
    studentId: string,
    input: CreateProfileEntryData,
  ): Promise<GovernedProfileEntryWrite>;
  listProfileEntries(
    studentId: string,
    kind?: ProfileEntry["kind"],
  ): Promise<ProfileEntry[]>;
  deleteProfileEntry(studentId: string, entryId: string): Promise<boolean>;
}

export function drizzleProfileData(db: () => NodePgDatabase): ProfileDataPort {
  return {
    studentExists: (studentId) => studentExists(db(), studentId),
    ensureProfile: (studentId) => ensureProfile(db(), studentId),
    updateProfile: (studentId, patch) => updateProfile(db(), studentId, patch),
    createProfileEntry: (studentId, input) =>
      createProfileEntry(db(), studentId, input),
    listProfileEntries: (studentId, kind) =>
      listProfileEntries(db(), studentId, kind),
    deleteProfileEntry: (studentId, entryId) =>
      deleteProfileEntry(db(), studentId, entryId),
  };
}

/**
 * The seam the adaptive-teaching engine (spec §6.4) calls when it changes
 * strategy: the transparency note is not optional here. Strategy changes that
 * cannot explain themselves in learner-readable words must not be recorded.
 */
export async function recordStrategyChange(
  db: NodePgDatabase,
  studentId: string,
  change: {
    detail: string;
    whyChanged: string;
    subject?: string;
    sourceAssessmentId?: string;
    sourceTurnId?: string;
  },
): Promise<ProfileEntry> {
  if (change.whyChanged.trim().length === 0) {
    throw new Error("a strategy change requires a whyChanged note (spec §6.2)");
  }
  const write = await createProfileEntry(db, studentId, {
    kind: "strategy_change",
    detail: change.detail,
    whyChanged: change.whyChanged,
    subject: change.subject,
    sourceAssessmentId: change.sourceAssessmentId,
    sourceTurnId: change.sourceTurnId,
  });
  return write.entry;
}

export async function listProfileEntries(
  db: NodePgDatabase,
  studentId: string,
  kind?: ProfileEntry["kind"],
): Promise<ProfileEntry[]> {
  const profile = await ensureProfile(db, studentId);
  const where =
    kind === undefined
      ? eq(profileEntries.profileId, profile.id)
      : and(
          eq(profileEntries.profileId, profile.id),
          eq(profileEntries.kind, kind),
        );
  return db
    .select()
    .from(profileEntries)
    .where(where)
    .orderBy(desc(profileEntries.createdAt));
}

/**
 * The student curates their own record: the entry row goes, the evidence rows
 * behind it (assessment, turn) are never deleted.
 */
export async function deleteProfileEntry(
  db: NodePgDatabase,
  studentId: string,
  entryId: string,
): Promise<boolean> {
  const profile = await ensureProfile(db, studentId);
  const [entry] = await db
    .select({ id: profileEntries.id })
    .from(profileEntries)
    .where(
      and(
        eq(profileEntries.id, entryId),
        eq(profileEntries.profileId, profile.id),
      ),
    )
    .limit(1);
  if (!entry) return false;

  await db.delete(profileEntries).where(eq(profileEntries.id, entryId));
  return true;
}
