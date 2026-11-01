import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EducatorPage from "@/app/educator/page";
import { AccessibilityProvider } from "@/lib/accessibility/AccessibilityProvider";
import {
  makeEducatorAssignment,
  makeEducatorLink,
  makeEducatorSupports,
  makePrefs,
  makeStudentSummary,
  makeUser,
} from "./fixtures";

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
    listEducatorStudents: vi.fn(),
    listEducatorLinks: vi.fn(),
    createEducatorLink: vi.fn(),
    listEducatorAssignments: vi.fn(),
    createEducatorAssignment: vi.fn(),
    getEducatorSupports: vi.fn(),
    updateEducatorSupports: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock("@/lib/api-client", () => apiClient);

// The a11y card inside the page runs on the app-wide AccessibilityProvider —
// its persistence boundary is mocked here like the dashboard page tests do.
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
  apiClient.getCurrentUser.mockResolvedValue({
    user: makeUser({ role: "educator", id: "u-educator-1" }),
  });
  apiClient.listEducatorStudents.mockResolvedValue({
    students: [
      makeStudentSummary({ studentId: "u-student-1", displayName: "Sam", gapCount: 2 }),
      makeStudentSummary({ studentId: "u-student-2", displayName: "Zoe", gapCount: 0 }),
    ],
  });
  apiClient.listEducatorLinks.mockResolvedValue({
    links: [
      makeEducatorLink(),
      makeEducatorLink({
        id: "el-2",
        studentId: "u-student-2",
        student: { id: "u-student-2", email: "zoe@example.com", displayName: "Zoe" },
        status: "pending",
      }),
    ],
  });
  apiClient.listEducatorAssignments.mockResolvedValue({
    assignments: [makeEducatorAssignment()],
  });
  apiClient.getEducatorSupports.mockResolvedValue(makeEducatorSupports());
  apiClient.updateEducatorSupports.mockResolvedValue(
    makeEducatorSupports({ supports: ["Chunk multi-step problems"], notes: null }),
  );
  apiClient.createEducatorAssignment.mockResolvedValue(makeEducatorAssignment());
  apiClient.createEducatorLink.mockResolvedValue(makeEducatorLink());
  fetchPrefs.mockResolvedValue(makePrefs());
  savePrefs.mockImplementation(async (patch: Record<string, unknown>) => ({
    ...makePrefs(),
    ...patch,
  }));
}

describe("EducatorPage orchestration", () => {
  // The real app mounts the provider in the root layout; tests render the
  // page directly so the provider is mounted here like the dashboard suite.
  function renderPage() {
    return render(
      <AccessibilityProvider>
        <EducatorPage />
      </AccessibilityProvider>,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.style.removeProperty("font-size");
  });

  it("renders the educator cards with fetched data once loaded", async () => {
    stubReady();
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Class gap report" })).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "Learning objectives" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your students" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Accessibility" })).toBeInTheDocument();
    // Both linked students appear; the gap-free one carries no support mark.
    expect(screen.getByRole("button", { name: /Sam/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Zoe/ })).toBeInTheDocument();
    // Pending links are visible with their consent state, never as active.
    expect(screen.getByText("Pending consent")).toBeInTheDocument();
  });

  it("selects a student and loads their supports into the form", async () => {
    const user = userEvent.setup();
    stubReady();
    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: /Sam/ })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Sam/ }));

    const supportsInput = await screen.findByLabelText("Supports (comma-separated)");
    await waitFor(() => {
      expect(supportsInput).toHaveValue("Prefer visual explanations");
    });
    expect(apiClient.getEducatorSupports).toHaveBeenCalledWith("u-student-1");
    expect(screen.getByRole("heading", { name: "Supports for Sam" })).toBeInTheDocument();
  });

  it("saves edited supports for the selected student", async () => {
    const user = userEvent.setup();
    stubReady();
    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: /Sam/ })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Sam/ }));

    const supportsInput = await screen.findByLabelText("Supports (comma-separated)");
    await waitFor(() => expect(supportsInput).toHaveValue("Prefer visual explanations"));

    await user.clear(supportsInput);
    await user.type(supportsInput, "Chunk multi-step problems");
    await user.click(screen.getByRole("button", { name: "Save supports" }));

    await waitFor(() => {
      expect(apiClient.updateEducatorSupports).toHaveBeenCalledWith("u-student-1", {
        supports: ["Chunk multi-step problems"],
        notes: null,
      });
    });
  });

  it("creates an assignment and re-reads the objectives list", async () => {
    const user = userEvent.setup();
    stubReady();
    renderPage();

    await waitFor(() => expect(screen.getByText("Counting coins to $1.00")).toBeInTheDocument());
    // The contract requires one linked student per assignment — pick Sam.
    await user.selectOptions(screen.getByLabelText("Assign to"), "u-student-1");
    await user.type(screen.getByLabelText("Title"), "Making change");
    await user.type(screen.getByLabelText("Subject"), "Money math");
    await user.click(screen.getByRole("button", { name: "Assign" }));

    await waitFor(() => {
      expect(apiClient.createEducatorAssignment).toHaveBeenCalledWith({
        title: "Making change",
        subject: "Money math",
        detail: null,
        studentId: "u-student-1",
      });
    });
    expect(apiClient.listEducatorAssignments).toHaveBeenCalled();
  });

  it("requests a link by student email", async () => {
    const user = userEvent.setup();
    stubReady();
    renderPage();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Your students" })).toBeInTheDocument(),
    );
    await user.type(screen.getByLabelText("Student email"), "newfamily@example.com");
    await user.click(screen.getByRole("button", { name: "Request link" }));

    await waitFor(() => {
      expect(apiClient.createEducatorLink).toHaveBeenCalledWith({
        studentEmail: "newfamily@example.com",
      });
    });
  });

  it("offers sign-in when the session is missing (401)", async () => {
    apiClient.getCurrentUser.mockRejectedValue(new apiClient.ApiError(401, "unauthorized", "nope"));
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Please sign in" })).toBeInTheDocument(),
    );
  });

  it("tells a non-educator role this space is not theirs", async () => {
    apiClient.getCurrentUser.mockResolvedValue({ user: makeUser() });
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "This space is for educators" })).toBeInTheDocument(),
    );
    // The role gate fires before any educator data call — no student rows are
    // ever fetched for a non-educator.
    expect(apiClient.listEducatorStudents).not.toHaveBeenCalled();
  });

  it("shows an honest error with retry when loading fails", async () => {
    apiClient.getCurrentUser.mockRejectedValue(new Error("database exploded"));
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "We couldn't load your class" })).toBeInTheDocument(),
    );
    expect(screen.getByText("database exploded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("passes axe in the ready state", async () => {
    stubReady();
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /Sam/ })).toBeInTheDocument());
    const { runAxe, expectNoViolations } = await import("./axe");
    expectNoViolations(await runAxe(container));
  });
});
