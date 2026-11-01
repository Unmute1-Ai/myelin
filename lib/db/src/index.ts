import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * TLS for the database connection (spec §6.11: encryption in transit).
 * node-postgres opens PLAINTEXT by default, so this is an explicit,
 * verifiable decision rather than an accident of the connection string:
 *
 *   - DATABASE_SSL=false disables TLS outright (local dev only).
 *   - DATABASE_SSL=require (or true) forces TLS with certificate checks.
 *   - Otherwise the URL's sslmode decides: disable → plaintext; require /
 *     verify-* → TLS; absent → TLS in production, plaintext in dev
 *     (localhost never carries a secret until the app is deployed).
 *
 * `verifyDatabaseTlsConfig` (artifacts/api-server crypto-config verifier)
 * fails a production boot that would silently ship plaintext.
 */
/**
 * The pool's TLS decision — full semantics in ./ssl.ts, the canonical home.
 * Kept as a re-export so existing `@workspace/db` consumers are unaffected.
 */
import { databaseSslConfig } from "./ssl";
export { databaseSslConfig };

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: databaseSslConfig(process.env.DATABASE_URL!),
});
export const db = drizzle(pool, { schema });

export * from "./schema";
