import { Router, type IRouter, type Request, type Response } from "express";
import { defaultAuthDeps } from "../auth/deps";
import { requireAuth } from "../auth/middleware";

const router: IRouter = Router();
router.use(requireAuth(defaultAuthDeps()));

const MAX_INPUT = 6_000;
const MAX_ASSESSMENT = 12_000;

function organismBase(): URL | null {
  const configured = process.env.MJ_ORGANISM_BASE_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    return url;
  } catch {
    return null;
  }
}

async function proxyJson(
  path: string,
  payload: Record<string, string>,
  res: Response,
): Promise<void> {
  const base = organismBase();
  if (!base) {
    res.status(503).json({
      code: "companion_provider_unavailable",
      message: "MJ is not connected. Configure MJ_ORGANISM_BASE_URL on the Myelin API server.",
    });
    return;
  }

  try {
    const target = new URL(path, base);
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    const data: unknown = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      res.status(upstream.status === 503 ? 503 : 502).json({
        code: "companion_provider_error",
        message: "MJ could not complete this turn. No action was executed.",
      });
      return;
    }
    res.json(data);
  } catch {
    res.status(502).json({
      code: "companion_provider_unavailable",
      message: "MJ could not be reached. No synthetic response was substituted.",
    });
  }
}

router.get("/status", (_req: Request, res: Response) => {
  res.json({
    mjConfigured: organismBase() !== null,
    jakeAvailable: true,
    authority: "advisory_only",
  });
});

router.post("/mj", async (req: Request, res: Response) => {
  const input = typeof req.body?.input === "string" ? req.body.input.trim() : "";
  if (!input || input.length > MAX_INPUT) {
    res.status(400).json({
      code: "invalid_request",
      message: "Input must contain 1–6000 characters.",
    });
    return;
  }
  await proxyJson("/api/organism/turn", { input }, res);
});

router.post("/synthesize", async (req: Request, res: Response) => {
  const input = typeof req.body?.input === "string" ? req.body.input.trim() : "";
  const mjAssessment = typeof req.body?.mjAssessment === "string" ? req.body.mjAssessment.trim() : "";
  const jakeAssessment = typeof req.body?.jakeAssessment === "string" ? req.body.jakeAssessment.trim() : "";
  if (
    !input || input.length > MAX_INPUT ||
    !mjAssessment || mjAssessment.length > MAX_ASSESSMENT ||
    !jakeAssessment || jakeAssessment.length > MAX_ASSESSMENT
  ) {
    res.status(400).json({
      code: "invalid_request",
      message: "Input and both specialist assessments are required within their size limits.",
    });
    return;
  }
  await proxyJson("/api/organism/synthesize", { input, mjAssessment, jakeAssessment }, res);
});

export default router;
