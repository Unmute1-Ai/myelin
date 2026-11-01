import {
  Router,
  type Request,
  type Response,
  type RequestHandler,
  type IRouter,
} from "express";
import {
  GetAccessibilityPrefsResponse,
  UpdateAccessibilityPrefsBody,
  UpdateAccessibilityPrefsResponse,
} from "@workspace/api-zod";
import { authorize } from "../auth/authorize";
import { requireAuth, type AuthedRequest } from "../auth/middleware";
import { defaultAuthDeps, type AuthDeps } from "../auth/deps";
import { parseBody, sendError } from "../lib/http";
import {
  drizzleAccessibilityData,
  type AccessibilityDataPort,
} from "../accessibility/accessibility-data";

/**
 * Accessibility-prefs routes (spec §6.8). The contract path is /me/accessibility:
 * the only subject is the authenticated caller themself — no id parameter
 * exists to name anyone else, so cross-user access is impossible by shape.
 * GET lazily creates the caller's row; PUT applies a validated partial patch.
 * Every read and write runs through authorize(), so each decision — allow or
 * deny — lands in the audit trail like every other data route.
 */
export interface AccessibilityDeps extends AuthDeps {
  data: AccessibilityDataPort;
  authenticate?: RequestHandler;
}

/** Production wiring: real sessions and the drizzle-backed prefs port. */
export function defaultAccessibilityDeps(): AccessibilityDeps {
  const auth = defaultAuthDeps();
  return { ...auth, data: drizzleAccessibilityData(auth.db) };
}

export function createAccessibilityRoutes(
  deps: AccessibilityDeps = defaultAccessibilityDeps(),
): IRouter {
  const router: IRouter = Router();

  router.use(deps.authenticate ?? requireAuth(deps));

  // ---------------------------------------------------------------------------
  // GET /accessibility — the caller's settings, created with product defaults
  // (captions on, TTS off) on first read. Mounted under /me.
  // ---------------------------------------------------------------------------
  router.get("/accessibility", async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;

    await authorize(user, "view_progress", { type: "user_data", userId: user.id }, deps);

    const prefs = await deps.data.ensurePrefs(user.id);
    res.json(GetAccessibilityPrefsResponse.parse(prefs));
  });

  // ---------------------------------------------------------------------------
  // PUT /accessibility — partial update, only the sent keys move. Validation
  // (break interval 1–240, textSize enum) comes from the generated contract
  // schema, mirroring the DB CHECK constraint.
  // ---------------------------------------------------------------------------
  router.put("/accessibility", async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;
    const body = parseBody(req, res, UpdateAccessibilityPrefsBody);
    if (body === undefined) return;

    await authorize(user, "edit_profile", { type: "user_data", userId: user.id }, deps);

    const prefs = await deps.data.updatePrefs(user.id, body);
    res.json(UpdateAccessibilityPrefsResponse.parse(prefs));
  });

  return router;
}
