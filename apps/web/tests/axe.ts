/*
 * Shared axe audit for rendered-state tests (spec §6.8, §7.9). axe-core
 * directly — it ships its own types and runs in jsdom. The callback form is
 * used because axe.run's overloaded promise typing resolves to void for
 * ReturnType extraction. The region rule is off: every card already sits
 * inside <main>, and a landmark per card would be noise, not structure.
 */
import axe from "axe-core";

export type AxeResults = axe.AxeResults;

export function runAxe(container: HTMLElement): Promise<axe.AxeResults> {
  return new Promise((resolve, reject) => {
    axe.run(container, { rules: { region: { enabled: false } } }, (error, results) => {
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      } else if (results) {
        resolve(results);
      } else {
        reject(new Error("axe returned neither results nor an error"));
      }
    });
  });
}

/** One assertion for every violation — failures print them all, not just the first. */
export function expectNoViolations(result: AxeResults): void {
  const summary = result.violations
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)
    .join("; ");
  if (result.violations.length > 0) {
    throw new Error(`axe found violations: ${summary}`);
  }
}
