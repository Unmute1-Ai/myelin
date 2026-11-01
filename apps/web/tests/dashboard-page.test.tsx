import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TextSize } from "@workspace/api-zod";
import DashboardPage from "@/app/dashboard/page";
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
    getAccessibilityPrefs: vi.fn(),
    updateAccessibilityPrefs: vi.fn(),
    updateLearningProfile: vi.fn(),
    createProfileEntry: vi.fn(),
    deleteProfileEntry: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock("@/lib/api-client", () => apiClient);

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
  apiClient.getAccessibilityPrefs.mockResolvedValue(makePrefs());
}

describe("DashboardPage orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.removeAttribute("data-high-contrast");
    document.documentElement.removeAttribute("data-reduced-motion");
    document.documentElement.style.removeProperty("font-size");
  });

  it("renders all ten components with fetched data once loaded", async () => {
    stubReady();
    render(<DashboardPage />);

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

  it("applies stored accessibility preferences app-wide on load", async () => {
    stubReady();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-high-contrast")).toBe("false");
    });
  });

  it("offers sign-in when the session is missing (401)", async () => {
    apiClient.getCurrentUser.mockRejectedValue(new apiClient.ApiError(401, "unauthorized", "nope"));
    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Please sign in" })).toBeInTheDocument());
  });

  it("tells a non-student role this space is not theirs", async () => {
    apiClient.getCurrentUser.mockResolvedValue({ user: makeUser({ role: "educator", id: "u-ed" }) });
    render(<DashboardPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "This space is for students" })).toBeInTheDocument(),
    );
  });

  it("shows an honest error with retry when loading fails", async () => {
    apiClient.getCurrentUser.mockRejectedValue(new Error("database exploded"));
    render(<DashboardPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "We couldn't load your dashboard" })).toBeInTheDocument(),
    );
    expect(screen.getByText("database exploded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("persists an accessibility toggle through the API and applies it immediately", async () => {
    stubReady();
    apiClient.updateAccessibilityPrefs.mockResolvedValue(makePrefs({ ttsEnabled: true }));
    const user = userEvent.setup();
    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByRole("switch", { name: /Read aloud/ })).toBeInTheDocument());

    await user.click(screen.getByRole("switch", { name: /Read aloud/ }));
    await waitFor(() => expect(apiClient.updateAccessibilityPrefs).toHaveBeenCalled());
    const sent = apiClient.updateAccessibilityPrefs.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.ttsEnabled).toBe(true);
    // Untouched fields keep their stored values — the merge is honest.
    expect(sent.captionsEnabled).toBe(true);
    expect(sent.textSize).toBe(TextSize.medium);
  });

  it("saves a subject change through the profile API", async () => {
    stubReady();
    apiClient.updateLearningProfile.mockResolvedValue({
      profile: makeProfile({ subjects: ["Money math", "Fractions"] }),
      entries: [makeEntry()],
    });
    const user = userEvent.setup();
    render(<DashboardPage />);
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
    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByLabelText("Subjects")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Subjects"), "Fractions");
    await user.click(screen.getByRole("button", { name: "Add" }));
    // Both saving cards surface the shared save error honestly.
    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      for (const alert of alerts) expect(alert).toHaveTextContent("Not allowed");
    });
  });
});
