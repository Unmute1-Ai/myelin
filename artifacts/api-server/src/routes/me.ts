import { Router, type Request, type Response, type RequestHandler, type IRouter } from "express";
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
} from "../accessibility/accessibility-service";

/**
 * Accessibility-preference routes (contract: GET/PATCH /me/accessibility,
 * spec §6.8). The caller IS the resource — there is no path parameter to
 * misread — and any user may set any preference (no diagnosis gate). The
 * ensure-on-read keeps a fresh account's first settings visit alive with
 * the product defaults for the Deaf/HoH-first audience: captions on, TTS
 * off. Decisions still pass through authorize() so the audit trail stays
 * complete (spec §6.11).
 */
export interface MeDeps extends AuthDeps {
  data: AccessibilityDataPort;
  authenticate?: RequestHandler;
}

/** Production wiring: real sessions and the drizzle-backed prefs port. */
export function defaultMeDeps(): MeDeps {
  const auth = defaultAuthDeps();
  return { ...auth, data: drizzleAccessibilityData(auth.db) };
}

export function createMeRoutes(deps: MeDeps = defaultMeDeps()): IRouter {
  const router: IRouter = Router();

  router.use(deps.authenticate ?? requireAuth(deps));

  router.get("/accessibility", async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;

    await authorize(user, "view_progress", { type: "user_data", userId: user.id }, deps);

    const prefs = await deps.data.ensurePrefs(user.id);

    res.json(GetAccessibilityPrefsResponse.parse(prefs));
  });

  router.patch("/accessibility", async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;
    const body = parseBody(req, res, UpdateAccessibilityPrefsBody);
    if (body === undefined) return;

    await authorize(user, "edit_profile", { type: "user_data", userId: user.id }, deps);

    try {
      const prefs = await deps.data.updatePrefs(user.id, body);
      res.json(UpdateAccessibilityPrefsResponse.parse(prefs));
    } catch (error) {
      // The DB CHECK (1–240 minutes) is the second line of defense behind the
      // contract schema; surfacing it as invalid_request keeps the shape honest.
      if (error instanceof Error && error.message.includes("accessibility_break_interval_range")) {
        sendError(res, 400, "invalid_request", "Break interval must stay within 1–240 minutes.");
        return;
      }
      throw error;
    }
  });

  return router;
}
