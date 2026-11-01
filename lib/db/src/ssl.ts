// Pure database TLS-decision helper, in its own side-effect-free module so
// configuration verifiers (artifacts/api-server/src/privacy/crypto-config.ts)
// can import it without loading the eager db singleton — which throws when
// DATABASE_URL is unset, even in tests that never touch a database.

/** PostgreSQL `sslmode` semantics the platform relies on (lib/db pool config). */
export type DatabaseSsl =
  | boolean
  | { rejectUnauthorized: true }
  | undefined;

/**
 * The pool's TLS decision for a connection string and environment:
 *   - `undefined`            → plaintext, allowed only outside production;
 *   - `{rejectUnauthorized}` → TLS with certificate verification.
 *
 *   - An explicit `DATABASE_SSL=false|0` opts out anywhere (a production
 *     opt-out is a configuration error the crypto-config verifier reports,
 *     not a silent downgrade this function performs);
 *   - an explicit `DATABASE_SSL=require|true|1` forces TLS anywhere;
 *   - Otherwise the URL's sslmode decides: disable → plaintext; require /
 *     verify-* → TLS; absent → TLS in production, plaintext in dev
 *     (localhost never carries a secret until the app is deployed).
 *
 * `verifyDatabaseTlsConfig` (artifacts/api-server crypto-config verifier)
 * fails a production boot that would silently ship plaintext.
 */
export function databaseSslConfig(
  url: string,
  env: { DATABASE_SSL?: string; NODE_ENV?: string } = process.env,
): DatabaseSsl {
  const setting = env.DATABASE_SSL?.trim().toLowerCase();
  if (setting === "false" || setting === "0") return undefined;
  if (setting === "require" || setting === "true" || setting === "1") {
    return { rejectUnauthorized: true };
  }
  let sslmode: string | null = null;
  try {
    sslmode = new URL(url).searchParams.get("sslmode");
  } catch {
    sslmode = null; // non-URL connection strings (key=value form) — treat as unset
  }
  if (sslmode === "disable") return undefined;
  if (sslmode !== null) return { rejectUnauthorized: true };
  return env.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined;
}

function isProduction(env: { NODE_ENV?: string }): boolean {
  return env.NODE_ENV === "production";
}
