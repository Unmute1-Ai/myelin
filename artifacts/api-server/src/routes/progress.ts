import { Router, type Request, type Response, type RequestHandler, type IRouter } from "express";
import {
  ListProgressEventsParamsSchema,
  ListProgressEventsQueryParams,
  ListProgressEventsResponse,
} from "@workspace/api-zod";
import { authorize } from "../auth/authorize";
import { requireAuth, type AuthedRequest } from "../auth/middleware";
import { defaultAuthDeps, type AuthDeps } from "../auth/deps";
import { parseParams, parseQuery, sendError } from "../lib/http";
import { drizzleProgressData, type ProgressDataPort } from "../progress/progress-service";

/**
 * Progress-timeline routes (contract: GET /progress/{studentId}, spec §6.7,
 * §6.9). Reads: the student themself, or a linked parent with granted
 * consent — the same policy as profile reads, because the timeline is the
 * learner's record. No write route exists here by design: the timeline is
 * append-only and written by the engines, never through the dashboards.
 *
 * Request/response shapes validate through the generated @workspace/api-zod
 * schemas.
 */
export interface ProgressDeps extends AuthDeps {
  data: ProgressDataPort;
  authenticate?: RequestHandler;
}

/** Production wiring: real sessions and the drizzle-backed progress port. */
export function defaultProgressDeps(): ProgressDeps {
  const auth = defaultAuthDeps();
  return { ...auth, data: drizzleProgressData(auth.db) };
}

export function createProgressRoutes(deps: ProgressDeps = defaultProgressDeps()): IRouter {
  const router: IRouter = Router();

  router.use(deps.authenticate ?? requireAuth(deps));

  router.get("/:studentId", async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;
    const params = parseParams(req, res, ListProgressEventsParamsSchema);
    if (params === undefined) return;
    const query = parseQuery(req, res, ListProgressEventsQueryParams);
    if (query === undefined) return;

    await authorize(
      user,
      "view_progress",
      { type: "user_data", userId: params.studentId },
      deps,
    );

    if (!(await deps.data.studentExists(params.studentId))) {
      sendError(res, 404, "student_not_found", "No student profile exists here.");
      return;
    }

    const events = await deps.data.listProgressEvents(params.studentId, query);

    res.json(ListProgressEventsResponse.parse({ events }));
  });

  return router;
}
