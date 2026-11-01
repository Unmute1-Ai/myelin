// Data-minimization tests (spec §6.11: data minimization — no camera,
// microphone, biometric, or location collection; no diagnosis field; no
// password hash in any response shape). Three layers, each a different
// failure surface:
//
//   1. the schema (drizzle columns) — a forbidden field cannot exist without
//      a column;
//   2. the generated migrations — a hand-added column shows up in SQL;
//   3. the API contract (openapi.yaml + generated zod) — a field could exist
//      in storage yet never be allowed to leak through a response shape.
//
// The contract layer is the one the mustHaves name: "no passwordHash in any
// response shape — extend the existing contract-test patterns" (the type-level
// mirror in lib/api-zod/contract.test.ts pins the User DTO; the scans here pin
// every generated schema and the source contract itself).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableName, getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "@workspace/db/schema";
import { publicUser } from "../auth/schemas";

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

/** Field names that must never exist anywhere in the platform's data model. */
const FORBIDDEN_FIELD_PATTERN = /diagnos|biometric|geolocation|latitude|longitude|camera|microphone/i;

/**
 * Declaration-shaped scan for YAML/TS sources: flags a forbidden FIELD NAME
 * declared as a key, not the word inside documentation prose — the contract's
 * own descriptions say "no diagnosis field exists anywhere", and that
 * enforcement language must not trip the scan.
 */
const DECLARED_FIELD_PATTERN =
  /^\s*"?(diagnos\w*|biometric\w*|geolocation|latitude|longitude|camera|microphone\w*)"?\s*:/im;

/** The same, for SQL migration files: a column name followed by a type. */
const SQL_COLUMN_PATTERN =
  /^\s*"?(diagnos\w*|biometric\w*|geolocation|latitude|longitude|camera|microphone\w*)"?\s+(text|varchar|uuid|integer|boolean|timestamp|jsonb)/im;

/** The auth-boundary secret: never a column of a response shape. */
const SECRET_FIELDS = ["passwordHash", "password_hash"] as const;

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

// The drizzle table objects under test, named explicitly: the schema module
// also re-exports zod validators, so reflection-by-shape is the fragile way
// to enumerate tables. A new table must join this list to be covered.
const tables = [
  schema.users,
  schema.guardianLinks,
  schema.consents,
  schema.learningProfiles,
  schema.profileEntries,
  schema.tutoringSessions,
  schema.sessionTurns,
  schema.assessments,
  schema.progressEvents,
  schema.accessibilityPrefs,
  schema.auditLog,
  schema.sessionMaterials,
];

describe("data minimization: schema layer (spec §6.11, §7.10)", () => {
  it("has no diagnosis, camera, microphone, biometric, or location column on any table", () => {
    expect(tables.length).toBeGreaterThanOrEqual(10);
    for (const table of tables) {
      const columns = Object.keys(getTableColumns(table));
      const offenders = columns.filter((column) => FORBIDDEN_FIELD_PATTERN.test(column));
      expect(offenders, `table ${getTableName(table)}`).toEqual([]);
    }
  });

  it("keeps the password hash out of every table except users", () => {
    for (const table of tables) {
      const columns = Object.keys(getTableColumns(table));
      const offenders = columns.filter((column) =>
        (SECRET_FIELDS as readonly string[]).includes(column),
      );
      if (getTableName(table) === "users") {
        // The hash lives exactly once, in the auth boundary's own table.
        expect(offenders).toEqual(["passwordHash"]);
      } else {
        expect(offenders, `table ${getTableName(table)}`).toEqual([]);
      }
    }
  });

  it("has no forbidden field in any generated migration", () => {
    const dir = join(REPO_ROOT, "lib", "db", "drizzle");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const sql = readFileSync(join(dir, file), "utf8");
      expect(sql, file).not.toMatch(SQL_COLUMN_PATTERN);
    }
  });
});

describe("data minimization: API contract layer (spec §6.11)", () => {
  const contract = readFileSync(join(REPO_ROOT, "lib", "api-spec", "openapi.yaml"), "utf8");
  const generatedFiles = walkTsFiles(join(REPO_ROOT, "lib", "api-zod", "src", "generated"));

  it("has no forbidden field anywhere in the OpenAPI contract", () => {
    expect(contract).not.toMatch(DECLARED_FIELD_PATTERN);
    expect(contract).not.toMatch(/passwordHash|password_hash/);
  });

  it("has no forbidden field in any generated zod schema or type", () => {
    expect(generatedFiles.length).toBeGreaterThan(0);
    for (const file of generatedFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(DECLARED_FIELD_PATTERN);
      expect(source, file).not.toMatch(/passwordHash|password_hash/);
    }
  });

  it("the user wire shape carries only the public fields — runtime proof", () => {
    // A full DB row, including the secret, goes in; the mapper decides what
    // leaves. This is the shape every auth response actually serializes.
    const row = {
      id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      email: "student@primer.test",
      passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$secret-material",
      role: "student" as const,
      displayName: "Sam",
      createdAt: new Date("2026-11-01T10:00:00.000Z"),
      updatedAt: new Date("2026-11-01T10:00:00.000Z"),
    };
    const wire = publicUser(row);
    expect(Object.keys(wire).sort()).toEqual(["createdAt", "displayName", "email", "id", "role"]);
    expect(JSON.stringify(wire)).not.toContain("secret-material");
    expect(JSON.stringify(wire)).not.toMatch(/passwordHash/i);
  });
});
