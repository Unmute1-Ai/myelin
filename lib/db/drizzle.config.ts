import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // Package-relative paths: the db:* scripts run with CWD = lib/db (pnpm
  // --filter), and drizzle-kit 0.31 mis-resolves an absolute `out` on this
  // runner ("./" concatenated onto the absolute path).
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
