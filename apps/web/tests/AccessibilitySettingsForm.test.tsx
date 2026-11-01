import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccessibilityProvider } from "@/lib/accessibility/AccessibilityProvider";
import { PrefsSignedOutError } from "@/lib/accessibility/api";
import { AccessibilitySettingsForm } from "@/components/accessibility/AccessibilitySettingsForm";
import { CaptionRegion } from "@/components/accessibility/CaptionRegion";
import { QuickResponses } from "@/components/accessibility/QuickResponses";
import { SpeakButton } from "@/components/accessibility/SpeakButton";

/*
 * The provider's persistence boundary is the lib/accessibility/api module —
 * mock it there, so these tests cover the whole real stack (provider logic,
 * form wiring, document application) without network plumbing.
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

function renderWithProvider(ui: React.ReactNode) {
  return render(<AccessibilityProvider>{ui}</AccessibilityProvider>);
}

beforeEach(() => {
  fetchPrefs.mockResolvedValue(STORED);
  savePrefs.mockImplementation(async (patch: Record<string, unknown>) => ({
    ...STORED,
    ...patch,
  }));
});

describe("AccessibilitySettingsForm — persistence", () => {
  it("saves a toggle and applies it to the document", async () => {
    const user = userEvent.setup();
    renderWithProvider(<AccessibilitySettingsForm />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("All saved"));

    await user.click(screen.getByRole("checkbox", { name: /read text aloud/i }));

    await waitFor(() => expect(savePrefs).toHaveBeenCalledWith({ ttsEnabled: true }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: /read text aloud/i })).toBeChecked(),
    );
    // The save completes and the honest status line confirms persistence.
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("All saved"));
  });

  it("persists a text-size change and updates the html attribute", async () => {
    const user = userEvent.setup();
    renderWithProvider(<AccessibilitySettingsForm />);
    await waitFor(() => expect(screen.getByRole("radio", { name: "Large" })).not.toBeDisabled());

    await user.click(screen.getByRole("radio", { name: "Large" }));

    await waitFor(() => expect(savePrefs).toHaveBeenCalledWith({ textSize: "large" }));
    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-text-size")).toBe("large"),
    );
  });

  it("applies a stored contrast preference on load", async () => {
    fetchPrefs.mockResolvedValue({ ...STORED, highContrast: true });
    renderWithProvider(<AccessibilitySettingsForm />);
    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-contrast")).toBe("high"),
    );
  });

  it("rejects an out-of-range break interval client-side and sends nothing", async () => {
    const user = userEvent.setup();
    renderWithProvider(<AccessibilitySettingsForm />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("All saved"));

    const interval = screen.getByLabelText(/break reminder interval/i);
    await user.clear(interval);
    await user.type(interval, "300");

    expect(savePrefs).not.toHaveBeenCalledWith({ breakIntervalMinutes: 300 });
  });

  it("shows an honest error and rolls back when a save fails", async () => {
    const user = userEvent.setup();
    savePrefs.mockRejectedValue(new Error("network down"));
    renderWithProvider(<AccessibilitySettingsForm />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("All saved"));

    await user.click(screen.getByRole("checkbox", { name: /high contrast/i }));

    // The status line carries the failure message; the alert explains the rollback.
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/could not be saved/i),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/before the failed save/i);
    expect(screen.getByRole("checkbox", { name: /high contrast/i })).not.toBeChecked();
  });
});

describe("AccessibilitySettingsForm — signed-out mode", () => {
  it("applies choices for this visit only, without a save attempt", async () => {
    const user = userEvent.setup();
    fetchPrefs.mockRejectedValue(new PrefsSignedOutError());
    renderWithProvider(<AccessibilitySettingsForm />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/not signed in/i));

    await user.click(screen.getByRole("checkbox", { name: /read text aloud/i }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: /read text aloud/i })).toBeChecked(),
    );
    expect(savePrefs).not.toHaveBeenCalled();
  });
});

describe("support components honor their preferences", () => {
  it("shows the Read aloud control only when TTS is on, and speaks on click", async () => {
    fetchPrefs.mockResolvedValue({ ...STORED, ttsEnabled: true });
    const user = userEvent.setup();
    const { container } = renderWithProvider(
      <>
        <SpeakButton text="Hello learner" />
        <CaptionRegion />
      </>,
    );
    await waitFor(() => expect(container.querySelector("button")).not.toBeNull());

    await user.click(screen.getByRole("button", { name: "Read aloud" }));
    await waitFor(() => expect(screen.getByText("Hello learner")).toBeInTheDocument());
  });

  it("renders no Read aloud control when TTS is off", async () => {
    const { container } = renderWithProvider(<SpeakButton text="Hello learner" />);
    // Provider readiness is the signal to wait for; the button then never mounts.
    await waitFor(() => expect(fetchPrefs).toHaveBeenCalled());
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows quick responses only when AAC input is enabled", async () => {
    fetchPrefs.mockResolvedValue({ ...STORED, aacInputEnabled: true });
    renderWithProvider(<QuickResponses />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "I need a break." })).toBeInTheDocument(),
    );
  });

  it("renders no phrase buttons when AAC input is off", async () => {
    const { container } = renderWithProvider(<QuickResponses />);
    await waitFor(() => expect(fetchPrefs).toHaveBeenCalled());
    expect(container.querySelector("button")).toBeNull();
  });
});
