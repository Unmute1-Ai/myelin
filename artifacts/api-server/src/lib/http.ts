import type { Request, Response } from "express";

/**
 * Shared request/response helpers for the auth, guardian, and profile routes.
 *
 * The parse helpers take a structural schema bound, not `z.ZodType<T>`: the
 * generated @workspace/api-zod schemas live in the root-`zod` (v3) type
 * universe while hand-written validators use `zod/v4`, and only a structural
 * signature infers `T` correctly for both. Behavior is identical in either
 * universe — safeParse in, discriminated result out.
 */
export type ParseSchema<T> = {
  safeParse(
    data: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: { path: PropertyKey[] }[] } };
};

export type ApiErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "invalid_credentials"
  | "forbidden"
  | "not_found"
  | "student_not_found"
  | "entry_not_found"
  | "link_not_found"
  | "email_already_registered"
  | "link_revoked"
  | "server_error";

/** 4xx/5xx with the platform error shape; never logs payload values. */
export function sendError(
  res: Response,
  status: number,
  code: ApiErrorCode,
  message: string,
): void {
  res.status(status).json({ code, message });
}

/** Validate a request body; responds 400 and returns undefined when invalid. */
export function parseBody<T>(
  req: Request,
  res: Response,
  schema: ParseSchema<T>,
): T | undefined {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    // Zod issue paths only — values can carry learner input.
    req.log?.warn(
      { fields: result.error.issues.map((i) => i.path.join(".")) },
      "request failed validation",
    );
    sendError(
      res,
      400,
      "invalid_request",
      "The request didn't match the expected shape.",
    );
    return undefined;
  }
  return result.data;
}

/** Validate route params; responds 400 and returns undefined when invalid. */
export function parseParams<T>(
  req: Request,
  res: Response,
  schema: ParseSchema<T>,
): T | undefined {
  const result = schema.safeParse(req.params);
  if (!result.success) {
    sendError(res, 400, "invalid_request", "A valid identifier is required.");
    return undefined;
  }
  return result.data;
}

/** Validate query parameters; responds 400 and returns undefined when invalid. */
export function parseQuery<T>(
  req: Request,
  res: Response,
  schema: ParseSchema<T>,
): T | undefined {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    sendError(
      res,
      400,
      "invalid_request",
      "The query parameters didn't match the expected shape.",
    );
    return undefined;
  }
  return result.data;
}
