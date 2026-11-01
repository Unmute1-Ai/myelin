import { Router, type Request, type Response, type RequestHandler, type IRouter } from "express";
import {
  GetParentMasteryOverviewParams,
  GetParentMasteryOverviewResponse,
  ListAtHomeActivitiesParams,
  ListAtHomeActivitiesResponse,
  ListParentSessionSummariesParamsSchema,
  ListParentSessionSummariesQueryParams,
  ListParentSessionSummariesResponse,
  ListParentStudentsResponse,
} from "@workspace/api-zod";
import { authorize } from "../auth/authorize";
import { requireAuth, requireRole, type AuthedRequest } from "../auth/middleware";
import { defaultAuthDeps, type AuthDeps } from "../auth/deps";
import { parseParams, parseQuery, sendError } from "../lib/http";
import {
  deriveAtHomeActivities,
  drizzleParentViewData,
  type ParentViewDataPort,
} from "../parents/parent-views";

/**
 * Parent-view routes (contract: GET /parent/students..., spec §6.9). The
 * parent dashboard's entire server surface — read-only, consent-gated:
 *
 * - `requireRole(parent)` keeps the lane to parents; students have their own
 *   dashboard, educators join via the educator lane, admin has no override.
 * - `authorize(view_progress, user_data)` checks the consent trail
 *   (granted link + unrevoked guardian_access consent) and audits every
 *   decision, allow or deny. Access ends the moment consent is revoked.
 * - No mutating route exists on this surface: parents view — they never
 *   start sessions, edit the record, or export it (spec §6.9).
 * - Summaries only: no route here returns session turn content.
 *
 * Request/response shapes validate through the generated @workspace/api-zod
 * schemas.
 */
export interface ParentViewDeps extends AuthDeps {
  data: ParentViewDataPort;
  authenticate?: RequestHandler;
}

/** Production wiring: real sessions and the drizzle-backed parent-view port. */
export function defaultParentViewDeps(): ParentViewDeps {
  const auth = defaultAuthDeps();
  return { ...auth, data: drizzleParentViewData(auth.db) };
}

export function createParentViewRoutes(deps: ParentViewDeps = defaultParentViewDeps()): IRouter {
  const router: IRouter = Router();

  router.use(deps.authenticate ?? requireAuth(deps));

  // ---------------------------------------------------------------------------
  // GET /parent/students — the caller's roster of linked students.
  // ---------------------------------------------------------------------------
  router.get("/students", requireRole(deps, "parent"), async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;
    const roster = await deps.data.listLinkedStudents(user.id);

    // accessGranted asks the consent authority (not the link status alone):
    // a granted link backed by an unrevoked guardian_access consent.
    const students = await Promise.all(
      roster.map(async (row) => ({
        ...row.student,
        linkStatus: row.linkStatus,
        accessGranted: await deps.guardianAccess.hasGrantedGuardianAccess(user.id, row.student.id),
      })),
    );

    res.json(ListParentStudentsResponse.parse({ students }));
  });

  // ---------------------------------------------------------------------------
  // GET /parent/students/:studentId/mastery — evidence-backed mastery overview.
  // ---------------------------------------------------------------------------
  router.get(
    "/students/:studentId/mastery",
    requireRole(deps, "parent"),
    async (req: Request, res: Response) => {
      const user = (req as AuthedRequest).user;
      const params = parseParams(req, res, GetParentMasteryOverviewParams);
      if (params === undefined) return;

      await authorize(user, "view_progress", { type: "user_data", userId: params.studentId }, deps);

      const overview = await deps.data.masteryOverview(params.studentId);
      if (overview === undefined) {
        // Owner passed the gate; the student row vanished between check and read.
        sendError(res, 404, "student_not_found", "This student no longer has an account.");
        return;
      }

      res.json(GetParentMasteryOverviewResponse.parse(overview));
    },
  );

  // ---------------------------------------------------------------------------
  // GET /parent/students/:studentId/sessions — summaries, never transcripts.
  // ---------------------------------------------------------------------------
  router.get(
    "/students/:studentId/sessions",
    requireRole(deps, "parent"),
    async (req: Request, res: Response) => {
      const user = (req as AuthedRequest).user;
      const params = parseParams(req, res, ListParentSessionSummariesParamsSchema);
      if (params === undefined) return;
      const query = parseQuery(req, res, ListParentSessionSummariesQueryParams);
      if (query === undefined) return;

      await authorize(user, "view_progress", { type: "user_data", userId: params.studentId }, deps);

      const sessions = await deps.data.sessionSummaries(params.studentId, query.limit);
      res.json(ListParentSessionSummariesResponse.parse({ sessions }));
    },
  );

  // ---------------------------------------------------------------------------
  // GET /parent/students/:studentId/activities — inert, record-derived suggestions.
  // ---------------------------------------------------------------------------
  router.get(
    "/students/:studentId/activities",
    requireRole(deps, "parent"),
    async (req: Request, res: Response) => {
      const user = (req as AuthedRequest).user;
      const params = parseParams(req, res, ListAtHomeActivitiesParams);
      if (params === undefined) return;

      await authorize(user, "view_progress", { type: "user_data", userId: params.studentId }, deps);

      const record = await deps.data.activityRecord(params.studentId);
      const activities = deriveAtHomeActivities(record);
      res.json(ListAtHomeActivitiesResponse.parse({ activities }));
    },
  );

  return router;
}
