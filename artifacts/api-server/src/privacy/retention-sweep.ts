// Retention-sweep CLI (spec §6.11). Built by build.mjs as
// dist/retention-sweep.mjs and run unattended:
//
//   node dist/retention-sweep.mjs --days=30 [--dormant-report=365]
//
// Exits 0 after a clean run (including "nothing to do"), 1 on failure —
// an unattended job must fail loudly, never swallow. Output is counts only;
// learner content never reaches the log.

import { db, pool } from "@workspace/db";
import { dbAuditLogger } from "../auth/audit";
import { countDormantAccounts, runRetentionSweep } from "./retention";

function intArg(name: string, fallback: number): number {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw.split("=")[1] ?? "", 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

const windowDays = intArg("days", 30);
const dormantReportDays = intArg("dormant-report", 0);

try {
  const result = await runRetentionSweep(db, windowDays, dbAuditLogger(() => db));
  const dormant =
    dormantReportDays > 0 ? await countDormantAccounts(db, dormantReportDays) : undefined;
  // Counts only — see the retention module header.
  console.log(JSON.stringify({ ...result, ...(dormant === undefined ? {} : { dormantAccounts: dormant }) }));
  await pool.end();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  await pool.end().catch(() => undefined);
  process.exit(1);
}
