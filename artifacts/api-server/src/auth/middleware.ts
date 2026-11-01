import type { NextFunction, Request, RequestHandler, Response } from "express";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { users, type User } from "@workspace/db/schema";
import type { AuditPort } from "./audit";
import type { UserRole } from "./schemas";
import { SESSION_COOKIE_NAME, SessionError, type SessionCodec } from "./session";

/** A request that has passed `requireAuth` — handlers read `user` directly. */
export interface AuthedRequest extends Request {
  user: User;
}

/**
 * Loads the session cookie, verifies it, and resolves the live user row.
 * Fail closed: no cookie, bad signature, expired token, or deleted account
 * all produce 401 — a valid-looking token is never a session by itself.
 */
export function requireAuth(deps: { db: () => NodePgDatabase; codec: SessionCodec }): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = req.cookies?.[SESSION_COOKIE_NAME];
      if (typeof token !== "string" || token.length === 0) {
        res.status(401).json({ code: "unauthorized", message: "Sign in to continue." });
        return;
      }
      const claims = deps.codec.verify(token);
      const [user] = await deps
        .db()
        .select()
        .from(users)
        .where(eq(users.id, claims.userId))
        .limit(1);
      if (!user) {
        // Fail closed — a token for a deleted account grants nothing.
        res.status(401).json({ code: "unauthorized", message: "Sign in to continue." });
        return;
      }
      (req as AuthedRequest).user = user;
      next();
    } catch (error) {
      if (error instanceof SessionError) {
        res.status(401).json({ code: "unauthorized", message: "Sign in to continue." });
        return;
      }
      next(error);
    }
  };
}

/**
 * Route-level role filter. Runs after requireAuth; a mismatch is denied with
 * an audit row so every gate refusal is visible in the trail.
 */
export function requireRole(deps: { audit: AuditPort }, ...roles: UserRole[]): RequestHandler {
  return async (req, res, next) => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      // requireAuth must run first; belt and braces, never a bypass.
      res.status(401).json({ code: "unauthorized", message: "Sign in to continue." });
      return;
    }
    if (!roles.includes(user.role)) {
      await deps.audit.record({
        actorId: user.id,
        action: "route_access",
        resourceType: "route",
        resourceId: null,
        decision: "denied",
        authorizationEvidence: { requiredRoles: roles, actualRole: user.role, route: req.originalUrl },
      });
      res.status(403).json({ code: "forbidden", message: "You don't have access to this resource." });
      return;
    }
    next();
  };
}
