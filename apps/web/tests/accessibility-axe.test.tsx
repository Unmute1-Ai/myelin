import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import axe from "axe-core";
import LandingPage from "@/app/page";
import LoginPage from "@/app/login/page";
import RegisterPage from "@/app/register/page";
import AccessibilityPage from "@/app/accessibility/page";
import { AccessibilityProvider } from "@/lib/accessibility/AccessibilityProvider";

/*
 * axe runs over every surface built so far (spec §6.8 / DoD #9). The `region`
 * rule is disabled for one known, deliberate exception: the skip link lives
 * outside the main landmark on purpose — it must be reachable before the
 * learner tabs into any page's content.
 */
const AXE_OPTIONS = { rules: { region: { enabled: false } } } as const;

async function expectNoViolations(ui: React.ReactElement) {
  const { container } = render(ui);
  const results = await axe.run(container, AXE_OPTIONS);
  expect(results.violations).toEqual([]);
}

describe("axe — every surface", () => {
  it("landing page is clean", async () => {
    await expectNoViolations(<LandingPage />);
  });

  it("login page is clean", async () => {
    await expectNoViolations(<LoginPage />);
  });

  it("register page is clean", async () => {
    await expectNoViolations(<RegisterPage />);
  });

  it("accessibility settings page is clean", async () => {
    await expectNoViolations(
      <AccessibilityProvider>
        <AccessibilityPage />
      </AccessibilityProvider>,
    );
  });
});
