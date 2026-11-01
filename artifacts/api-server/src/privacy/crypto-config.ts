// Encryption-configuration verifier (spec §6.11: "encryption in transit and
// at rest"). Scope honesty: the repo controls the cookie flags, the database
// TLS decision, and the password hashing parameters; transport TLS for HTTP
// is terminated by the deployment platform and the Postgres volume encryption
// is the database operator's — this verifier asserts everything the codebase
// actually decides and documents the rest:
//
//   in transit  — session cookies are httpOnly+secure in production; the
//                 database connection requires TLS in production
//                 (databaseSslConfig, lib/db); an explicit DATABASE_SSL=false
//                 in production is a configuration error, not a silent
//                 downgrade.
//   at rest     — password hashing is argon2id at the OWASP interactive
//                 parameters (m=19456 KiB, t=2, p=1); learner content columns
//                 live inside the database whose at-rest encryption the
//                 deployment owns (documented in .env.example and the Docker
//                 deployment notes).

import { databaseSslConfig } from "@workspace/db/ssl";
import { sessionCookieOptions } from "../auth/session";

/** One named configuration check and what it found. */
export interface CryptoConfigCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export type CryptoEnv = {
  DATABASE_URL?: string;
  DATABASE_SSL?: string;
  NODE_ENV?: string;
  SESSION_SECRET?: string;
};

/** Production means the secure defaults bind; anything else is a dev machine. */
function isProduction(env: CryptoEnv): boolean {
  return env.NODE_ENV === "production";
}

/** Cookie flags the session layer actually emits for this environment. */
function cookieCheck(env: CryptoEnv): CryptoConfigCheck {
  const options = sessionCookieOptions();
  const ok = options.httpOnly === true && (!isProduction(env) || options.secure === true);
  return {
    name: "session_cookies",
    ok,
    detail: `httpOnly=${options.httpOnly} secure=${options.secure} (NODE_ENV=${env.NODE_ENV ?? "unset"})`,
  };
}

/** The database connection's TLS decision for this environment. */
function databaseTlsCheck(env: CryptoEnv): CryptoConfigCheck {
  const url = env.DATABASE_URL ?? "";
  const ssl = databaseSslConfig(url, env);
  const ok = !isProduction(env) || ssl !== undefined;
  return {
    name: "database_tls",
    ok,
    detail:
      ssl === undefined
        ? "plaintext (allowed only outside production)"
        : "TLS required (rejectUnauthorized=true)",
  };
}

/**
 * Password hashing must be argon2id at the OWASP interactive parameters.
 * Verified against the PHC string a real hash produces, so a regression in
 * @node-rs/argon2 or a swapped algorithm fails loudly here.
 */
async function passwordHashingCheck(): Promise<CryptoConfigCheck> {
  const { hashPassword } = await import("@workspace/db/password");
  const phc = (await hashPassword("crypto-config-probe")).split("$");
  // [$, argon2id, v=19, m=19456,t=2,p=1, salt, hash]
  const algorithm = phc[1];
  const params = phc[3] ?? "";
  const ok =
    algorithm === "argon2id" &&
    params.includes("m=19456") &&
    params.includes("t=2") &&
    params.includes("p=1");
  return {
    name: "password_hashing",
    ok,
    detail: `${algorithm} ${params}`,
  };
}

/**
 * Run every platform-controlled encryption check. Returns them all — a
 * caller decides how to surface failures (tests assert each one; the boot
 * path throws via assertEncryptionConfiguration).
 */
export async function verifyEncryptionConfiguration(env: CryptoEnv): Promise<CryptoConfigCheck[]> {
  return [cookieCheck(env), databaseTlsCheck(env), await passwordHashingCheck()];
}

/**
 * Boot-time gate for production: throws with every violated check named.
 * Dev environments pass through — plaintext localhost and non-secure cookies
 * are the documented dev posture, never a production one.
 */
export async function assertEncryptionConfiguration(env: CryptoEnv): Promise<void> {
  if (!isProduction(env)) return;
  const checks = await verifyEncryptionConfiguration(env);
  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    throw new Error(
      `Encryption configuration check failed: ${failed.map((check) => `${check.name} (${check.detail})`).join("; ")}`,
    );
  }
}
