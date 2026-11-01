// Eval runner: a fixed scenario suite across any set of providers. The
// report carries no timestamps so the committed snapshot stays deterministic.

import type { TutorProvider } from "../types";
import { ProviderDriver } from "./harness";
import { makeContext, SCENARIOS, type Scenario, type ScenarioContext } from "./scenarios";

export interface ScenarioResult {
  provider: string;
  scenarioId: string;
  title: string;
  status: "pass" | "fail";
  /** First assertion failure or provider error, null on pass. */
  error: string | null;
  /** Learner turns the scenario issued before it stopped. */
  turns: number;
}

export interface EvalReport {
  suite: "primer-provider-eval@1";
  providers: string[];
  results: ScenarioResult[];
}

/** Run one scenario against one provider, capturing the first failure. */
export async function runScenario(provider: TutorProvider, scenario: Scenario): Promise<ScenarioResult> {
  const driver = new ProviderDriver(provider);
  const ctx: ScenarioContext = makeContext(driver);
  try {
    await scenario.run(ctx);
    return { provider: provider.name, scenarioId: scenario.id, title: scenario.title, status: "pass", error: null, turns: driver.turnCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { provider: provider.name, scenarioId: scenario.id, title: scenario.title, status: "fail", error: message, turns: driver.turnCount };
  }
}

/** Run every scenario against every provider, in order. */
export async function runEvalSuite(providers: readonly TutorProvider[]): Promise<EvalReport> {
  const results: ScenarioResult[] = [];
  for (const provider of providers) {
    for (const scenario of SCENARIOS) {
      results.push(await runScenario(provider, scenario));
    }
  }
  return {
    suite: "primer-provider-eval@1",
    providers: providers.map((p) => p.name),
    results,
  };
}
