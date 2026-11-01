import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/dashboard/page";
import { AccessibilityProvider } from "@/lib/accessibility/AccessibilityProvider";
import { makeEntry, makePrefs, makeProfile, makeProgressEvent, makeSession, makeUser } from "./fixtures";

// The orchestrator is under test — its API calls are stubbed at the client
// boundary, keeping contract-typed fixtures between the two. The mock
// ApiError class lives inside the hoisted block so the page's instanceof
// checks match the same class the tests throw.
const apiClient = vi.hoisted(() => {
  class MockApiError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return {
    ApiError: MockApiError,
    getCurrentUser: vi.fn(),
    getStudentProfile: vi.fn(),
    listProgressEvents: vi.fn(),
    listSessions: vi.fn(),
    updateLearningProfile: vi.fn(),
    createProfileEntry: vi.fn(),
    deleteProfileEntry: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock("@/lib/api-client", () => apiClient);

/*
 * The a11y card inside the page runs on the app-wide AccessibilityProvider
 * (PR #13's canonical system) — its persistence boundary is mocked here like
 * the card tests, so the page orchestrator test sees the real provider.
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

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

function stubReady() {
  apiClient.getCurrentUser.mockResolvedValue({ user: makeUser() });
  apiClient.getStudentProfile.mockResolvedValue({
    profile: makeProfile(),
    entries: [makeEntry()],
  });
  apiClient.listProgressEvents.mockResolvedValue({ events: [makeProgressEvent()] });
  apiClient.listSessions.mockResolvedValue({ sessions: [makeSession()] });
  fetchPrefs.mockResolvedValue(makePrefs());
  savePrefs.mockImplementation(async (patch: Record<string, unknown>) => ({
    ...makePrefs(),
    ...patch,
  }));
}

describe("DashboardPage orchestration", () => {
  // The real app mounts the provider in the root layout; tests render the
  // page directly, so the provider is mounted here like the axe suite does.
  function renderPage() {
    return render(
      <AccessibilityProvider>
        <DashboardPage />
      </AccessibilityProvider>,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.style.removeProperty("font-size");
  });

  it("renders all ten components with fetched data once loaded", async () => {
    stubReady();
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Sam" })).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "Learning objectives" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Continue learning" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your subjects" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your progress" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mastery evidence" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recommended for you" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent sessions" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your learning profile" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Accessibility" })).toBeInTheDocument();
    // Real data flowed through: the fetched entry detail and session title
    // (the title shows in both continue-learning and recent sessions).
    expect(screen.getByText("Pictures help me understand fractions")).toBeInTheDocument();
    expect(screen.getAllByText("Money math practice").length).toBeGreaterThanOrEqual(2);
    expect(apiClient.listSessions).toHaveBeenCalledWith({ limit: 10 });
  });

  it("applies stored accessibility preferences app-wide on load (canonical PR #13 attributes)", async () => {
    stubReady();
    renderPage();

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-contrast")).toBe("normal");
      expect(document.documentElement.getAttribute("data-text-size")).toBe("medium");
      expect(document.documentElement.getAttribute("data-motion")).toBe("full");
    });
  });

  it("offers sign-in when the session is missing (401)", async () => {
    apiClient.getCurrentUser.mockRejectedValue(new apiClient.ApiError(401, "unauthorized", "nope"));
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Please sign in" })).toBeInTheDocument());
  });

  it("tells a non-student role this space is not theirs", async () => {
    apiClient.getCurrentUser.mockResolvedValue({ user: makeUser({ role: "educator", id: "u-ed" }) });
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "This space is for students" })).toBeInTheDocument(),
    );
  });

  it("shows an honest error with retry when loading fails", async () => {
    apiClient.getCurrentUser.mockRejectedValue(new Error("database exploded"));
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "We couldn't load your dashboard" })).toBeInTheDocument(),
    );
    expect(screen.getByText("database exploded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("persists an accessibility toggle through the canonical provider (PUT contract)", async () => {
    stubReady();
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByRole("switch", { name: /Read aloud/ })).toBeInTheDocument());

    await user.click(screen.getByRole("switch", { name: /Read aloud/ }));
    // The provider sends the field-only patch; the merge lives there (covered
    // by the provider's own tests) — the page just renders the result.
    await waitFor(() => expect(savePrefs).toHaveBeenCalledWith({ ttsEnabled: true }));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: /Read aloud/ })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
  });

  it("saves a subject change through the profile API", async () => {
    stubReady();
    apiClient.updateLearningProfile.mockResolvedValue({
      profile: makeProfile({ subjects: ["Money math", "Fractions"] }),
      entries: [makeEntry()],
    });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Subjects")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Subjects"), "Fractions");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(apiClient.updateLearningProfile).toHaveBeenCalled());
    expect(apiClient.updateLearningProfile).toHaveBeenCalledWith("u-student-1", {
      subjects: ["Money math", "Fractions"],
      pacing: "standard",
      preferredStrategy: null,
    });
  });

  it("surfaces a save failure instead of pretending it worked", async () => {
    stubReady();
    apiClient.updateLearningProfile.mockRejectedValue(
      new apiClient.ApiError(403, "forbidden", "Not allowed"),
    );
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Subjects")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Subjects"), "Fractions");
    await user.click(screen.getByRole("button", { name: "Add" }));
    // The profile card surfaces the shared save error honestly (the a11y card
    // owns its save status through the provider).
    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      for (const alert of alerts) expect(alert).toHaveTextContent("Not allowed");
    });
  });
});
