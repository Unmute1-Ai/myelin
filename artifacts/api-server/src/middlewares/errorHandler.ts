import type { NextFunction, Request, Response } from "express";
import { ForbiddenError } from "../auth/authorize";
import { SessionError } from "../auth/session";

/**
 * Typed auth errors become their status codes; anything unexpected is a
 * logged 500 with a generic body — error objects only, never payload values.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ForbiddenError) {
    res.status(403).json({ code: "forbidden", message: err.message });
    return;
  }
  if (err instanceof SessionError) {
    res.status(401).json({ code: "unauthorized", message: "Sign in to continue." });
    return;
  }
  req.log?.error({ err }, "unhandled request failure");
  res.status(500).json({ code: "server_error", message: "Something went wrong. Try again in a moment." });
}
