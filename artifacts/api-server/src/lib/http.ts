import type { Request, Response } from "express";
import type { z } from "zod/v4";

/**
 * Shared request/response helpers for the auth and guardian routes.
 *
 * The tutor routes carry their own copies bound to the generated api-zod
 * contract; the API-contract wave can adopt this module for them when it
 * reworks those routes. Deliberately not imported there yet — that package's
 * files are being regenerated in a parallel lane.
 */

export type ApiErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "invalid_credentials"
  | "forbidden"
  | "not_found"
  | "student_not_found"
  | "link_not_found"
  | "email_already_registered"
  | "link_revoked"
  | "server_error";

/** 4xx/5xx with the platform error shape; never logs payload values. */
export function sendError(res: Response, status: number, code: ApiErrorCode, message: string): void {
  res.status(status).json({ code, message });
}

/** Validate a request body; responds 400 and returns undefined when invalid. */
export function parseBody<T>(req: Request, res: Response, schema: z.ZodType<T>): T | undefined {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    // Zod issue paths only — values can carry learner input.
    req.log?.warn({ fields: result.error.issues.map((i) => i.path.join(".")) }, "request failed validation");
    sendError(res, 400, "invalid_request", "The request didn't match the expected shape.");
    return undefined;
  }
  return result.data;
}

/** Validate route params; responds 400 and returns undefined when invalid. */
export function parseParams<T>(req: Request, res: Response, schema: z.ZodType<T>): T | undefined {
  const result = schema.safeParse(req.params);
  if (!result.success) {
    sendError(res, 400, "invalid_request", "A valid identifier is required.");
    return undefined;
  }
  return result.data;
}
