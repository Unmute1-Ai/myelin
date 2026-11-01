// Encryption-configuration tests (spec §6.11: "encryption in transit and at
// rest"). Scope honesty baked into crypto-config.ts: the codebase decides the
// cookie flags, the database TLS decision, and the password hashing
// parameters; platform TLS termination and volume encryption are documented,
// not code. These tests pin the code-decided parts — and pin that a
// production boot REFUSES insecure configuration instead of silently
// downgrading (the boot gate in src/index.ts runs the same verifier).

import { afterAll, describe, expect, it } from "vitest";
import { assertEncryptionConfiguration, verifyEncryptionConfiguration } from "./crypto-config";

const PROD_DATABASE_URL = "postgres://primer:secret@db.internal:5432/primer?sslmode=require";

const previousNodeEnv = process.env.NODE_ENV;
afterAll(() => {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
});

function productionEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: PROD_DATABASE_URL,
    SESSION_SECRET: "production-secret-0123456789abcdef0123456789abcdef",
    ...overrides,
  };
}

describe("encryption configuration (spec §6.11)", () => {
  it("passes every check under a secure production configuration", async () => {
    // sessionCookieOptions reads NODE_ENV from the real environment.
    process.env.NODE_ENV = "production";
    const checks = await verifyEncryptionConfiguration(productionEnv());
    expect(checks.map((check) => [check.name, check.ok])).toEqual([
      ["session_cookies", true],
      ["database_tls", true],
      ["password_hashing", true],
    ]);
  });

  it("fails the TLS check when DATABASE_SSL=false would silently downgrade production", async () => {
    const checks = await verifyEncryptionConfiguration(productionEnv({ DATABASE_SSL: "false" }));
    const tls = checks.find((check) => check.name === "database_tls");
    expect(tls!.ok).toBe(false);
    expect(tls!.detail).toContain("plaintext");
  });

  it("fails the TLS check on sslmode=disable in production", async () => {
    const checks = await verifyEncryptionConfiguration(
      productionEnv({ DATABASE_URL: "postgres://primer:secret@db.internal:5432/primer?sslmode=disable" }),
    );
    expect(checks.find((check) => check.name === "database_tls")!.ok).toBe(false);
  });

  it("refuses an insecure production boot, naming every violated check", async () => {
    await expect(
      assertEncryptionConfiguration(productionEnv({ DATABASE_SSL: "false" })),
    ).rejects.toThrow(/database_tls/);
  });

  it("passes through non-production environments — dev plaintext is the documented posture", async () => {
    await expect(
      assertEncryptionConfiguration({
        NODE_ENV: "development",
        DATABASE_URL: "postgres://primer:secret@localhost:5432/primer",
        SESSION_SECRET: "dev-secret",
      }),
    ).resolves.toBeUndefined();
  });

  it("hashes passwords with argon2id at the OWASP interactive parameters", async () => {
    const checks = await verifyEncryptionConfiguration(productionEnv());
    const hashing = checks.find((check) => check.name === "password_hashing");
    expect(hashing!.ok).toBe(true);
    // The detail carries the PHC params — proof this ran a real hash, not a
    // constant check.
    expect(hashing!.detail).toMatch(/argon2id m=19456,t=2,p=1/);
  });
});
