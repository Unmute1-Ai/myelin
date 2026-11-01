import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessibilityProvider } from "@/lib/accessibility/AccessibilityProvider";
import { AccessibilitySettingsCard } from "@/components/dashboard/accessibility-settings-card";
import { expectNoViolations, runAxe } from "./axe";
import { makePrefs } from "./fixtures";

/*
 * The card consumes the app-wide AccessibilityProvider (PR #13's canonical
 * system). Its persistence boundary is the lib/accessibility/api module —
 * mock it there, so these tests cover the whole real stack (provider logic,
 * card wiring, document application) without network plumbing.
 */
const fetchPrefs = vi.fn();
const savePrefs = vi.fn();

vi.mock("@/lib/accessibility/api", () => ({
  PrefsSignedOutError: class PrefsSignedOutError extends Error {
    constructor() {
      super("not signed in");
    }
  },
  PrefsRequestError: class PrefsRequestError extends Error {},
  fetchAccessibilityPrefs: () => fetchPrefs(),
  saveAccessibilityPrefs: (patch: unknown) => savePrefs(patch),
}));

describe("AccessibilitySettingsCard", () => {
  beforeEach(() => {
    fetchPrefs.mockResolvedValue(makePrefs());
    savePrefs.mockImplementation(async (patch: Record<string, unknown>) => ({
      ...makePrefs(),
      ...patch,
    }));
  });

  it("renders every toggle with its stored state as a switch", async () => {
    render(
      <AccessibilityProvider>
        <AccessibilitySettingsCard />
      </AccessibilityProvider>,
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("All saved"));
    expect(screen.getByRole("switch", { name: /Read aloud/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("switch", { name: /Captions/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("saves a toggle through the provider and reports the new value", async () => {
    const user = userEvent.setup();
    render(
      <AccessibilityProvider>
        <AccessibilitySettingsCard />
      </AccessibilityProvider>,
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("All saved"));

    await user.click(screen.getByRole("switch", { name: /Read aloud/ }));

    await waitFor(() => expect(savePrefs).toHaveBeenCalledWith({ ttsEnabled: true }));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: /Read aloud/ })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
  });

  it("saves a text-size choice through the radio group", async () => {
    const user = userEvent.setup();
    render(
      <AccessibilityProvider>
        <AccessibilitySettingsCard />
      </AccessibilityProvider>,
    );
    await waitFor(() => expect(screen.getByRole("radio", { name: "Extra large" })).toBeEnabled());

    await user.click(screen.getByRole("radio", { name: "Extra large" }));

    await waitFor(() => expect(savePrefs).toHaveBeenCalledWith({ textSize: "xlarge" }));
  });

  it("shows the break interval only when break reminders are on", async () => {
    const user = userEvent.setup();
    render(
      <AccessibilityProvider>
        <AccessibilitySettingsCard />
      </AccessibilityProvider>,
    );
    await waitFor(() => expect(screen.getByRole("slider")).toHaveValue("25"));

    // Turn break reminders off through the provider's own update path.
    savePrefs.mockImplementation(async () => makePrefs({ allowBreaks: false }));
    await user.click(screen.getByRole("switch", { name: /Break reminders/ }));

    await waitFor(() => expect(screen.queryByRole("slider")).not.toBeInTheDocument());
  });

  it("surfaces a save failure as an alert", async () => {
    savePrefs.mockRejectedValue(new Error("Saving didn't work — try again."));
    const user = userEvent.setup();
    render(
      <AccessibilityProvider>
        <AccessibilitySettingsCard />
      </AccessibilityProvider>,
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("All saved"));

    await user.click(screen.getByRole("switch", { name: /Read aloud/ }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/could not be saved/i),
    );
  });

  it("passes axe", async () => {
    const { container } = render(
      <AccessibilityProvider>
        <AccessibilitySettingsCard />
      </AccessibilityProvider>,
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("All saved"));
    expectNoViolations(await runAxe(container));
  });
});
