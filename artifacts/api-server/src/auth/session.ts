import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod/v4";
import type { UserRole } from "./schemas";

/**
 * Stateless signed session cookies (HMAC-SHA256 over a JSON payload).
 *
 * Trade-off accepted for v1: tokens cannot be revoked server-side (logout
 * only clears the browser cookie), while every AUTHORIZATION decision still
 * hits the database through `authorize()` — so consent revocation takes
 * effect immediately even though the token itself stays cryptographically
 * valid until it expires. A sessions table can replace this without touching
 * call sites if revocable auth sessions become a requirement.
 */

export const SESSION_COOKIE_NAME = "primer_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const claimsSchema = z.object({
  userId: z.uuid(),
  role: z.enum(["student", "parent", "educator", "admin"]),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});

export type SessionClaims = z.infer<typeof claimsSchema>;

export class SessionError extends Error {
  constructor(message = "Session token is invalid or expired.") {
    super(message);
    this.name = "SessionError";
  }
}

export interface SessionCodec {
  sign(claims: { userId: string; role: UserRole }): string;
  /** Validates signature, shape, and expiry; throws SessionError on any failure. */
  verify(token: string): SessionClaims;
}

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

export function createSessionCodec(
  secret: () => string,
  ttlSeconds: number = SESSION_TTL_SECONDS,
  nowSeconds: () => number = () => Math.floor(Date.now() / 1000),
): SessionCodec {
  function mac(payload: string): string {
    return createHmac("sha256", secret()).update(payload).digest("base64url");
  }

  return {
    sign(claims) {
      const issuedAt = nowSeconds();
      const payload = base64url(
        JSON.stringify({ ...claims, iat: issuedAt, exp: issuedAt + ttlSeconds }),
      );
      return `${payload}.${mac(payload)}`;
    },

    verify(token) {
      const parts = token.split(".");
      if (parts.length !== 2) throw new SessionError();
      const [payload, signature] = parts;

      // Digests are fixed-length, so timingSafeEqual is usable after the
      // length check (comparing unequal lengths early is not a leak — the
      // token is invalid either way).
      const expected = Buffer.from(mac(payload), "base64url");
      const provided = Buffer.from(signature, "base64url");
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        throw new SessionError();
      }

      let rawClaims: unknown;
      try {
        rawClaims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      } catch {
        throw new SessionError();
      }
      const parsed = claimsSchema.safeParse(rawClaims);
      if (!parsed.success) throw new SessionError();
      if (parsed.data.exp <= nowSeconds()) throw new SessionError("Session expired — sign in again.");
      return parsed.data;
    },
  };
}

/** SameSite=Lax blunts cross-site POST CSRF; Secure applies outside local/dev. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS * 1000,
  };
}

/** Fail closed: no secret, no sessions. Read lazily so importing stays side-effect free. */
export function sessionSecretFromEnv(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret === undefined || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set to at least 32 characters (generate one with: openssl rand -hex 32).",
    );
  }
  return secret;
}
