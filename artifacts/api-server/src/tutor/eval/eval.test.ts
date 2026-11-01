// Eval harness tests. CI (no keys): the scripted provider must pass every
// fixed scenario and the committed snapshot must match. Dev (keys present):
// the same scenarios run against available cloud providers — their results
// are the parity signal the spec's Gemma-local launch gate consumes.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAvailableCloudProviders } from "../provider";
import { createScriptedProvider } from "../provider/scripted";
import type { EvalReport } from "./run";
import { runEvalSuite } from "./run";
import { SCENARIOS } from "./scenarios";

const SNAPSHOT_PATH = join(dirname(fileURLToPath(import.meta.url)), "snapshot", "eval-results.json");
const UPDATE_SNAPSHOT = process.env["EVAL_UPDATE_SNAPSHOT"] === "1";

function failures(report: EvalReport): EvalReport["results"] {
  return report.results.filter((r) => r.status === "fail");
}

describe("provider eval suite", () => {
  it("every fixed scenario passes for the scripted provider", async () => {
    const report = await runEvalSuite([createScriptedProvider()]);
    expect(failures(report)).toEqual([]);
    // The suite is the four fixed scenarios — no silent drift in coverage.
    expect(report.results).toHaveLength(SCENARIOS.length);
    expect(report.results.map((r) => r.scenarioId)).toEqual(SCENARIOS.map((s) => s.id));
  });

  it("runs deterministically — two runs produce identical reports", async () => {
    const [a, b] = await Promise.all([runEvalSuite([createScriptedProvider()]), runEvalSuite([createScriptedProvider()])]);
    expect(a).toEqual(b);
  });

  it("matches the committed snapshot", async () => {
    const report = await runEvalSuite([createScriptedProvider()]);
    if (UPDATE_SNAPSHOT) {
      mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
      writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    const committed = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as EvalReport;
    expect(report).toEqual(committed);
  });

  describe("dev-configured cloud providers", () => {
    const cloud = createAvailableCloudProviders();

    it.skipIf(cloud.length === 0)(
      "complete the fixed scenarios without unexpected crashes",
      async () => {
        const report = await runEvalSuite(cloud);
        // Every scenario ran for every provider — cloud outages surface as
        // failures with the provider name, never as silent coverage holes.
        expect(report.results).toHaveLength(SCENARIOS.length * cloud.length);
        // Real models are expected to pass; a failure here is the eval doing
        // its job — fix the model/prompt or update the provider contract.
        expect(failures(report)).toEqual([]);
      },
      120_000,
    );
  });
});
