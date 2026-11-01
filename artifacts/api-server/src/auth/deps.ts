import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { hashPassword, verifyPassword } from "@workspace/db/password";
import { dbAuditLogger, type AuditPort } from "./audit";
import { drizzleGuardianAccess } from "./guardian-access";
import type { GuardianAccessPort } from "./authorize";
import { createSessionCodec, sessionSecretFromEnv, type SessionCodec } from "./session";

export interface PasswordPort {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}

export const argon2Passwords: PasswordPort = {
  hash: (password) => hashPassword(password),
  verify: (passwordHash, password) => verifyPassword(passwordHash, password),
};

export interface AuthDeps {
  db(): NodePgDatabase;
  passwords: PasswordPort;
  codec: SessionCodec;
  audit: AuditPort;
  guardianAccess: GuardianAccessPort;
}

let cachedDb: NodePgDatabase | undefined;

/**
 * Builds the handle on first use, not at import — importing this module must
 * stay side-effect free so unrelated test files (no DATABASE_URL, no
 * SESSION_SECRET) keep working, and a missing env fails the request that
 * needs it rather than the process boot.
 */
function defaultDb(): NodePgDatabase {
  cachedDb ??= buildDefaultDb();
  return cachedDb;
}

function buildDefaultDb(): NodePgDatabase {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL must be set to serve authenticated routes.");
  }
  return drizzle(new pg.Pool({ connectionString }));
}

/** Production wiring: real argon2, signed cookies, audited decisions. */
export function defaultAuthDeps(): AuthDeps {
  return {
    db: defaultDb,
    passwords: argon2Passwords,
    codec: createSessionCodec(sessionSecretFromEnv),
    audit: dbAuditLogger(defaultDb),
    guardianAccess: drizzleGuardianAccess(defaultDb),
  };
}
