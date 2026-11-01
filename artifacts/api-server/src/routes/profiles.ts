import {
  Router,
  type Request,
  type Response,
  type RequestHandler,
  type IRouter,
} from "express";
import {
  CreateProfileEntryParams,
  CreateProfileEntryResponse,
  DeleteProfileEntryParams,
  GetStudentProfileParams,
  GetStudentProfileResponse,
  ListProfileEntriesParamsSchema,
  ListProfileEntriesQueryParams,
  ListProfileEntriesResponse,
  UpdateLearningProfileBody,
  UpdateLearningProfileParams,
  UpdateLearningProfileResponse,
} from "@workspace/api-zod";
import { authorize } from "../auth/authorize";
import { requireAuth, type AuthedRequest } from "../auth/middleware";
import { defaultAuthDeps, type AuthDeps } from "../auth/deps";
import { parseBody, parseParams, parseQuery, sendError } from "../lib/http";
import { CreateProfileEntryInput } from "../profiles/entry-rules";
import {
  drizzleProfileData,
  ProfileEvidenceError,
  UnlicensedInterpretationError,
  type ProfileDataPort,
  type ProfilePatch,
} from "../profiles/profile-service";

/**
 * Profile-route wiring: the auth surface (sessions, policy, audit) plus the
 * profile data port. Tests substitute the port (in-memory) and may replace
 * the session boundary — the real one is `requireAuth`, covered by the auth
 * suite; profile tests target the profile policy, not session mechanics.
 */
export interface ProfileDeps extends AuthDeps {
  data: ProfileDataPort;
  authenticate?: RequestHandler;
}

/** Production wiring: real sessions and drizzle-backed profile data. */
export function defaultProfileDeps(): ProfileDeps {
  const auth = defaultAuthDeps();
  return { ...auth, data: drizzleProfileData(auth.db) };
}

/**
 * The learning-profile routes (spec §6.2): the transparent, student-owned
 * learning record. Reads: the student themself, or a linked parent with
 * granted consent. Writes: the student alone — parents view, they never edit
 * (spec §6.9, minimal surveillance); educators join when the educator lane's
 * linking model exists and until then are denied by the fail-closed policy
 * (spec §6.1). Every decision — allow or deny — is audited inside
 * `authorize()`.
 *
 * Request/response shapes validate through the generated @workspace/api-zod
 * schemas; the only local refinement is the evidence-rule layer in
 * profiles/entry-rules.ts (evidence-only gaps, whyChanged on strategy
 * changes).
 */
export function createProfileRoutes(
  deps: ProfileDeps = defaultProfileDeps(),
): IRouter {
  const router: IRouter = Router();

  router.use(deps.authenticate ?? requireAuth(deps));

  // ---------------------------------------------------------------------------
  // GET /profiles/:studentId — the profile with its full entry record.
  // ---------------------------------------------------------------------------
  router.get("/:studentId", async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;
    const params = parseParams(req, res, GetStudentProfileParams);
    if (params === undefined) return;

    await authorize(
      user,
      "view_progress",
      { type: "user_data", userId: params.studentId },
      deps,
    );

    if (!(await deps.data.studentExists(params.studentId))) {
      sendError(
        res,
        404,
        "student_not_found",
        "No student profile exists here.",
      );
      return;
    }

    const profile = await deps.data.ensureProfile(params.studentId);
    const entries = await deps.data.listProfileEntries(params.studentId);

    res.json(GetStudentProfileResponse.parse({ profile, entries }));
  });

  // ---------------------------------------------------------------------------
  // PATCH /profiles/:studentId — explicit choices only (subjects, strategy
  // pick, pacing). A strategy_change entry is the transparency record for a
  // change the engine made; PATCH is the student's own deliberate choice and
  // needs no why-note beyond the audit row.
  // ---------------------------------------------------------------------------
  router.patch("/:studentId", async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;
    const params = parseParams(req, res, UpdateLearningProfileParams);
    if (params === undefined) return;
    const body = parseBody(req, res, UpdateLearningProfileBody);
    if (body === undefined) return;

    await authorize(
      user,
      "edit_profile",
      { type: "user_data", userId: params.studentId },
      deps,
    );

    if (!(await deps.data.studentExists(params.studentId))) {
      sendError(
        res,
        404,
        "student_not_found",
        "No student profile exists here.",
      );
      return;
    }

    // Only the provided keys move; `preferredStrategy: null` is a deliberate
    // clear (the contract types it nullish for exactly this reason).
    const patch: ProfilePatch = {};
    const changedFields: string[] = [];
    if (body.subjects !== undefined) {
      patch.subjects = body.subjects;
      changedFields.push("subjects");
    }
    if ("preferredStrategy" in body) {
      patch.preferredStrategy = body.preferredStrategy ?? null;
      changedFields.push("preferredStrategy");
    }
    if (body.pacing !== undefined) {
      patch.pacing = body.pacing;
      changedFields.push("pacing");
    }

    const updated = await deps.data.updateProfile(params.studentId, patch);

    await deps.audit.record({
      actorId: user.id,
      action: "update_learning_profile",
      resourceType: "learning_profile",
      resourceId: updated.id,
      decision: "allowed",
      authorizationEvidence: { role: user.role, changedFields },
    });

    res.json(UpdateLearningProfileResponse.parse(updated));
  });

  // ---------------------------------------------------------------------------
  // GET /profiles/:studentId/entries — the transparent record, newest first,
  // optionally filtered by kind.
  // ---------------------------------------------------------------------------
  router.get("/:studentId/entries", async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;
    const params = parseParams(req, res, ListProfileEntriesParamsSchema);
    if (params === undefined) return;
    const query = parseQuery(req, res, ListProfileEntriesQueryParams);
    if (query === undefined) return;

    await authorize(
      user,
      "view_progress",
      { type: "user_data", userId: params.studentId },
      deps,
    );

    if (!(await deps.data.studentExists(params.studentId))) {
      sendError(
        res,
        404,
        "student_not_found",
        "No student profile exists here.",
      );
      return;
    }

    const entries = await deps.data.listProfileEntries(
      params.studentId,
      query.kind,
    );
    res.json(ListProfileEntriesResponse.parse({ entries }));
  });

  // ---------------------------------------------------------------------------
  // POST /profiles/:studentId/entries — record an entry. The governed write
  // path (spec §6.0) rejects unresolvable citations (ProfileEvidenceError →
  // 400) and conclusions the evidence kind does not license
  // (UnlicensedInterpretationError → 400); a replayed identical proposal
  // returns the original entry. Strategy changes must explain themselves.
  // ---------------------------------------------------------------------------
  router.post("/:studentId/entries", async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;
    const params = parseParams(req, res, CreateProfileEntryParams);
    if (params === undefined) return;
    const body = parseBody(req, res, CreateProfileEntryInput);
    if (body === undefined) return;

    await authorize(
      user,
      "edit_profile",
      { type: "user_data", userId: params.studentId },
      deps,
    );

    if (!(await deps.data.studentExists(params.studentId))) {
      sendError(
        res,
        404,
        "student_not_found",
        "No student profile exists here.",
      );
      return;
    }

    let entry;
    let replayed: boolean;
    try {
      const write = await deps.data.createProfileEntry(params.studentId, body);
      entry = write.entry;
      replayed = write.replayed;
    } catch (error) {
      if (
        error instanceof ProfileEvidenceError ||
        error instanceof UnlicensedInterpretationError
      ) {
        sendError(res, 400, "invalid_request", error.message);
        return;
      }
      throw error;
    }

    await deps.audit.record({
      actorId: user.id,
      action: "create_profile_entry",
      resourceType: "profile_entry",
      resourceId: entry.id,
      decision: "allowed",
      authorizationEvidence: {
        role: user.role,
        kind: entry.kind,
        hasEvidence:
          entry.sourceAssessmentId !== null || entry.sourceTurnId !== null,
        replayed,
      },
    });

    // A deduped replay is not a creation — 200 with the original entry, not
    // 201; the body is the existing row either way (spec §6.0).
    res.status(replayed ? 200 : 201).json(CreateProfileEntryResponse.parse(entry));
  });

  // ---------------------------------------------------------------------------
  // DELETE /profiles/:studentId/entries/:entryId — the student curates their
  // own record; the evidence rows behind an entry are never deleted.
  // ---------------------------------------------------------------------------
  router.delete(
    "/:studentId/entries/:entryId",
    async (req: Request, res: Response) => {
      const user = (req as AuthedRequest).user;
      const params = parseParams(req, res, DeleteProfileEntryParams);
      if (params === undefined) return;

      await authorize(
        user,
        "edit_profile",
        { type: "user_data", userId: params.studentId },
        deps,
      );

      if (!(await deps.data.studentExists(params.studentId))) {
        sendError(
          res,
          404,
          "student_not_found",
          "No student profile exists here.",
        );
        return;
      }

      const deleted = await deps.data.deleteProfileEntry(
        params.studentId,
        params.entryId,
      );
      if (!deleted) {
        // Exists nowhere under this student's profile — do not leak whether it
        // lives under someone else's.
        sendError(res, 404, "entry_not_found", "No profile entry exists here.");
        return;
      }

      await deps.audit.record({
        actorId: user.id,
        action: "delete_profile_entry",
        resourceType: "profile_entry",
        resourceId: params.entryId,
        decision: "allowed",
        authorizationEvidence: { role: user.role },
      });

      res.status(204).send();
    },
  );

  return router;
}
