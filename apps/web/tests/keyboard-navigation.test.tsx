import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RootLayout from "@/app/layout";
import LandingPage from "@/app/page";
import { AccessibilityProvider } from "@/lib/accessibility/AccessibilityProvider";
import { AccessibilitySettingsForm } from "@/components/accessibility/AccessibilitySettingsForm";

const fetchPrefs = vi.fn();
const savePrefs = vi.fn();

vi.mock("@/lib/accessibility/api", () => ({
  PrefsSignedOutError: class PrefsSignedOutError extends Error {},
  PrefsRequestError: class PrefsRequestError extends Error {},
  fetchAccessibilityPrefs: () => fetchPrefs(),
  saveAccessibilityPrefs: (patch: unknown) => savePrefs(patch),
}));

const STORED = {
  id: "b7e18ad6-0f2e-4f5a-9c3d-1a2b3c4d5e6f",
  userId: "c8f29be7-1a3f-4e6b-8d4c-2b3c4d5e6f7a",
  ttsEnabled: false,
  captionsEnabled: true,
  highContrast: false,
  textSize: "medium" as const,
  reducedMotion: false,
  aacInputEnabled: false,
  allowBreaks: true,
  breakIntervalMinutes: 20,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

beforeEach(() => {
  fetchPrefs.mockResolvedValue(STORED);
  savePrefs.mockImplementation(async (patch: Record<string, unknown>) => ({
    ...STORED,
    ...patch,
  }));
});

const focusables = (root: ParentNode) =>
  Array.from(
    root.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), input:not([disabled]), select, textarea",
    ),
  );

describe("keyboard navigation — landing surface", () => {
  // The skip link is a root-layout element, so the real composition is
  // layout + page; the page alone never contains it.
  it("puts the skip link first and pairs it with the main landmark", () => {
    render(
      <RootLayout>
        <LandingPage />
      </RootLayout>,
    );
    const focusable = focusables(document.body);
    expect(focusable[0]).toHaveAccessibleName("Skip to main content");
    expect(focusable[0].getAttribute("href")).toBe("#main");
    expect(document.querySelector("main#main")).not.toBeNull();
  });

  it("keeps every interactive element native and free of positive tabindex", () => {
    render(
      <RootLayout>
        <LandingPage />
      </RootLayout>,
    );
    for (const el of focusables(document.body)) {
      expect(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]).toContain(el.tagName);
      expect(Number(el.getAttribute("tabindex") ?? "0")).toBeLessThanOrEqual(0);
    }
  });

  it("reaches Sign in, Create an account, then Accessibility settings in tab order", () => {
    render(
      <RootLayout>
        <LandingPage />
      </RootLayout>,
    );
    const names = focusables(document.body).map((el) => el.textContent?.trim() ?? "");
    expect(names).toEqual([
      "Skip to main content",
      "Sign in",
      "Create an account",
      "Accessibility settings",
    ]);
  });
});

describe("keyboard navigation — settings form", () => {
  it("toggles a preference with Space alone (native checkbox)", async () => {
    const user = userEvent.setup();
    render(
      <AccessibilityProvider>
        <AccessibilitySettingsForm />
      </AccessibilityProvider>,
    );
    const checkbox = screen.getByRole("checkbox", { name: /read text aloud/i });
    await waitFor(() => expect(checkbox).not.toBeDisabled());

    checkbox.focus();
    await user.keyboard(" ");
    await waitFor(() => expect(checkbox).toBeChecked());
    expect(savePrefs).toHaveBeenCalledWith({ ttsEnabled: true });

    await user.keyboard(" ");
    await waitFor(() => expect(checkbox).not.toBeChecked());
    expect(savePrefs).toHaveBeenCalledWith({ ttsEnabled: false });
  });

  it("selects a text size with Space on the focused radio (native radio group)", async () => {
    const user = userEvent.setup();
    render(
      <AccessibilityProvider>
        <AccessibilitySettingsForm />
      </AccessibilityProvider>,
    );
    const large = screen.getByRole("radio", { name: "Large" });
    await waitFor(() => expect(large).not.toBeDisabled());

    large.focus();
    await user.keyboard(" ");
    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-text-size")).toBe("large"),
    );
    expect(savePrefs).toHaveBeenCalledWith({ textSize: "large" });
  });

  it("keeps every form control labeled for screen readers", () => {
    render(
      <AccessibilityProvider>
        <AccessibilitySettingsForm />
      </AccessibilityProvider>,
    );
    for (const el of focusables(document.body)) {
      if (el.tagName === "INPUT") {
        expect(el).toHaveAccessibleName();
      }
    }
  });
});
