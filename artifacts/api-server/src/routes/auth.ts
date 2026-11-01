import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { users, type User } from "@workspace/db/schema";
import {
  LoginBody,
  RegisterBody,
  UserResponse,
  publicUser,
} from "../auth/schemas";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "../auth/session";
import { requireAuth, type AuthedRequest } from "../auth/middleware";
import { defaultAuthDeps, type AuthDeps } from "../auth/deps";
import { parseBody, sendError } from "../lib/http";

/**
 * Auth routes (spec §6.1): registration and login for all four roles,
 * logout, and the session echo. Every issued session uses argon2id hashes
 * and signed httpOnly cookies; nothing here bypasses the authorize()
 * boundary used by data routes.
 */

/**
 * Verifying a throwaway hash when the account doesn't exist so unknown-email
 * and wrong-password responses take the same time (no account enumeration
 * via timing). The string is not a credential — its preimage is irrelevant.
 */
let dummyHashPromise: Promise<string> | undefined;
async function equalizeTiming(deps: AuthDeps, password: string): Promise<boolean> {
  dummyHashPromise ??= deps.passwords.hash("primer-timing-equalizer");
  return deps.passwords.verify(await dummyHashPromise, password);
}

function issueSession(res: { cookie(name: string, token: string, options: unknown): void }, deps: AuthDeps, user: User): void {
  const token = deps.codec.sign({ userId: user.id, role: user.role });
  res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions());
}

export function createAuthRoutes(deps: AuthDeps = defaultAuthDeps()): IRouter {
  const router: IRouter = Router();

  router.post("/register", async (req, res) => {
    const body = parseBody(req, res, RegisterBody);
    if (body === undefined) return;

    const [existing] = await deps.db().select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
    if (existing) {
      sendError(res, 409, "email_already_registered", "That email already has an account. Try logging in instead.");
      return;
    }

    const [user] = await deps
      .db()
      .insert(users)
      .values({
        email: body.email,
        passwordHash: await deps.passwords.hash(body.password),
        role: body.role,
        displayName: body.displayName,
      })
      .returning();

    await deps.audit.record({
      actorId: user.id,
      action: "register",
      resourceType: "user",
      resourceId: user.id,
      decision: "allowed",
      authorizationEvidence: { role: user.role },
    });

    issueSession(res, deps, user);
    res.status(201).json(UserResponse.parse({ user: publicUser(user) }));
  });

  router.post("/login", async (req, res) => {
    const body = parseBody(req, res, LoginBody);
    if (body === undefined) return;

    const [user] = await deps.db().select().from(users).where(eq(users.email, body.email)).limit(1);
    const passwordOk = user
      ? await deps.passwords.verify(user.passwordHash, body.password)
      : await equalizeTiming(deps, body.password);
    if (!user || !passwordOk) {
      // One response for both failure modes — never reveal which part missed.
      // The trail records the failure without the attempted email (data
      // minimization: a login form is not an identity attribute).
      await deps.audit.record({
        actorId: null,
        action: "login_failed",
        resourceType: "user",
        resourceId: null,
        decision: "denied",
        authorizationEvidence: { reason: "invalid_credentials" },
      });
      sendError(res, 401, "invalid_credentials", "Email or password didn't match.");
      return;
    }

    await deps.audit.record({
      actorId: user.id,
      action: "login",
      resourceType: "user",
      resourceId: user.id,
      decision: "allowed",
      authorizationEvidence: { role: user.role },
    });

    issueSession(res, deps, user);
    res.json(UserResponse.parse({ user: publicUser(user) }));
  });

  router.post("/logout", async (req, res) => {
    const maybeUser = (req as AuthedRequest).user ?? null;
    await deps.audit.record({
      actorId: maybeUser?.id ?? null,
      action: "logout",
      resourceType: "user",
      resourceId: maybeUser?.id ?? null,
      decision: "allowed",
      authorizationEvidence: {},
    });
    res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
    res.status(204).send();
  });

  router.get("/me", requireAuth(deps), (req, res) => {
    res.json(UserResponse.parse({ user: publicUser((req as AuthedRequest).user) }));
  });

  return router;
}
