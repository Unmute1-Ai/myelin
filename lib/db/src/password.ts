import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";

/**
 * Password hashing for user accounts (spec §6.1) — argon2id with the OWASP
 * interactive-login parameters (m=19 MiB, t=2, p=1). Shared by the API and
 * the demo seed so every writer of users.password_hash uses one algorithm.
 *
 * This module deliberately has no database or environment coupling: it is
 * exported as its own subpath so consumers (route modules, the seed) can
 * import it without provisioning a pool.
 */
const ARGON2ID_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  if (password.length === 0) throw new Error("password must not be empty");
  return argon2Hash(password, ARGON2ID_OPTIONS);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return argon2Verify(passwordHash, password);
}
