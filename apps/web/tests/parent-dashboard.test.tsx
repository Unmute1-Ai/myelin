/*
 * Page orchestration tests for the parent dashboard (spec §6.9). The API
 * calls are stubbed at the client boundary with contract-typed fixtures —
 * what is under test is the wiring: identity → role gate → roster →
 * per-learner views, and every honest state off the happy path
 * (signed-out, wrong-role, load error, revoked-consent denial).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ParentDashboardPage from "@/app/parent/page";
import {
  makeAtHomeActivity,
  makeMasteryOverview,
  makeParentSessionSummary,
  makeParentStudent,
  makeParentUser,
} from "./fixtures";

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
    listParentStudents: vi.fn(),
    getParentMasteryOverview: vi.fn(),
    listParentSessionSummaries: vi.fn(),
    listAtHomeActivities: vi.fn(),
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
  apiClient.getCurrentUser.mockResolvedValue({ user: makeParentUser() });
  apiClient.listParentStudents.mockResolvedValue({
    students: [makeParentStudent()],
  });
  apiClient.getParentMasteryOverview.mockResolvedValue(makeMasteryOverview());
  apiClient.listParentSessionSummaries.mockResolvedValue({
    sessions: [makeParentSessionSummary()],
  });
  apiClient.listAtHomeActivities.mockResolvedValue({
    activities: [makeAtHomeActivity()],
  });
}

describe("ParentDashboardPage orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads identity, roster, and the selected learner's three views", async () => {
    stubReady();
    render(<ParentDashboardPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Family dashboard" })).toBeInTheDocument();
    });
    expect(apiClient.listParentStudents).toHaveBeenCalled();
    await waitFor(() => {
      expect(apiClient.getParentMasteryOverview).toHaveBeenCalledWith("u-student-1");
      expect(apiClient.listParentSessionSummaries).toHaveBeenCalledWith("u-student-1");
      expect(apiClient.listAtHomeActivities).toHaveBeenCalledWith("u-student-1");
    });
    // The consented learner's views render.
    expect(screen.getByText("Mastery overview")).toBeInTheDocument();
    expect(screen.getByText("Tutoring sessions")).toBeInTheDocument();
    expect(screen.getByText("At-home activities")).toBeInTheDocument();
  });

  it("routes a signed-out visitor to sign in", async () => {
    apiClient.getCurrentUser.mockRejectedValue(new apiClient.ApiError(401, "unauthorized", "no"));
    render(<ParentDashboardPage />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Please sign in" })).toBeInTheDocument();
    });
  });

  it("tells a non-parent which space they reached and offers theirs", async () => {
    apiClient.getCurrentUser.mockResolvedValue({
      user: makeParentUser({ role: "student", displayName: "Sam" }),
    });
    render(<ParentDashboardPage />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "This space is for families" })).toBeInTheDocument();
    });
    expect(apiClient.listParentStudents).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Go to your dashboard" }));
    expect(push).toHaveBeenCalledWith("/dashboard");
  });

  it("shows an honest empty state when no learners are linked", async () => {
    apiClient.getCurrentUser.mockResolvedValue({ user: makeParentUser() });
    apiClient.listParentStudents.mockResolvedValue({ students: [] });
    render(<ParentDashboardPage />);
    await waitFor(() => {
      expect(screen.getByText("No learners linked yet")).toBeInTheDocument();
    });
    expect(apiClient.getParentMasteryOverview).not.toHaveBeenCalled();
  });

  it("surfaces a revoked-consent denial instead of a generic error", async () => {
    stubReady();
    apiClient.getParentMasteryOverview.mockRejectedValue(
      new apiClient.ApiError(403, "forbidden", "Consent is not granted"),
    );
    render(<ParentDashboardPage />);
    await waitFor(() => {
      expect(screen.getByText("Consent isn't active")).toBeInTheDocument();
    });
    expect(screen.getByText(/Family access isn't active for Sam/)).toBeInTheDocument();
    // The sibling views never pretend to load successfully.
    expect(screen.queryByText("At-home activities")).not.toBeInTheDocument();
  });

  it("retries a failed view load from its error state", async () => {
    stubReady();
    apiClient.listAtHomeActivities
      .mockRejectedValueOnce(new apiClient.ApiError(500, "internal_error", "boom"))
      .mockResolvedValueOnce({ activities: [makeAtHomeActivity()] });
    render(<ParentDashboardPage />);
    await waitFor(() => {
      expect(screen.getByText("We couldn't load the summaries")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(screen.getByText("At-home activities")).toBeInTheDocument();
    });
  });

  it("reloads views when another learner is selected", async () => {
    stubReady();
    apiClient.listParentStudents.mockResolvedValue({
      students: [
        makeParentStudent(),
        makeParentStudent({ id: "u-student-2", displayName: "Alex" }),
      ],
    });
    render(<ParentDashboardPage />);
    await waitFor(() => {
      expect(apiClient.getParentMasteryOverview).toHaveBeenCalledWith("u-student-1");
    });
    await userEvent.click(screen.getByRole("button", { name: /Alex/ }));
    await waitFor(() => {
      expect(apiClient.getParentMasteryOverview).toHaveBeenCalledWith("u-student-2");
    });
  });

  it("signs out from the header", async () => {
    stubReady();
    render(<ParentDashboardPage />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => {
      expect(apiClient.logout).toHaveBeenCalled();
      expect(push).toHaveBeenCalledWith("/login");
    });
  });
});
