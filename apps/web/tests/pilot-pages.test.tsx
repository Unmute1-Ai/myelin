import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import PilotEnrollPage from "@/app/pilot/enroll/page";
import PilotGatePage from "@/app/pilot/gate/page";

/*
 * Pilot surfaces (U1Si-Q): the enrollment form and the approval-gate demo.
 * Clients are mocked at the module boundary (the repo's page-test pattern);
 * the hoisted MockPilotApiError keeps the pages' instanceof checks on the
 * same class the mocks throw.
 */

const pilotApi = vi.hoisted(() => {
  class MockPilotApiError extends Error {
    readonly status: number;
    readonly code: string | null;
    constructor(status: number, code: string | null, message: string) {
      super(message);
      this.name = "PilotApiError";
      this.status = status;
      this.code = code;
    }
  }
  return {
    PilotApiError: MockPilotApiError,
    createPilotInvite: vi.fn(),
    pilotEnroll: vi.fn(),
    listPilotEnrollments: vi.fn(),
    listPilotProposals: vi.fn(),
    proposePilotAction: vi.fn(),
    confirmPilotAction: vi.fn(),
  };
});

vi.mock("@/lib/pilot-api", () => pilotApi);

const sessionApi = vi.hoisted(() => ({
  getMe: vi.fn(),
}));

vi.mock("@/lib/session-api", () => sessionApi);

// The `region` rule exception matches the repo-wide axe harness: the skip
// link lives outside the main landmark on purpose.
const AXE_OPTIONS = { rules: { region: { enabled: false } } } as const;

const PENDING_PROPOSAL = {
  id: "prop_1",
  action: "export_pilot_report",
  status: "pending" as const,
  checkLine: "Only the person who proposed it, or a founder, can act on it.",
  proposedBy: "user_1",
  proposedByName: "Pilot Participant",
  decidedBy: null,
  decidedByName: null,
  decidedAt: null,
  result: null,
  createdAt: "2026-11-26T00:00:00.000Z",
};

const EXECUTED_PROPOSAL = {
  ...PENDING_PROPOSAL,
  id: "prop_2",
  status: "executed" as const,
  proposedBy: "user_2",
  proposedByName: "Founder",
  decidedBy: "user_admin",
  decidedByName: "Other Founder",
  decidedAt: "2026-11-26T01:00:00.000Z",
  result: { participantCount: 3 },
};

describe("pilot enrollment page", () => {
  it("passes axe with no violations", async () => {
    const { container } = render(<PilotEnrollPage />);
    const results = await axe.run(container, AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });

  it("shows the privacy disclosure BEFORE the consent checkbox in DOM order", () => {
    const { container } = render(<PilotEnrollPage />);
    const disclosure = container.querySelector("#privacy-heading");
    const consent = container.querySelector('input[name="consentToParticipate"]');
    expect(disclosure).not.toBeNull();
    expect(consent).not.toBeNull();
    // comparison means: disclosure comes before consent in document order
    expect(disclosure!.compareDocumentPosition(consent!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("refuses to enroll without consent and moves focus to the consent checkbox", async () => {
    const user = userEvent.setup();
    render(<PilotEnrollPage />);
    await user.type(screen.getByLabelText("Invite code"), "PILOT-CODE-123");
    await user.type(screen.getByLabelText("Email", { selector: "input[type=email]" }), "pilot@example.com");
    await user.type(screen.getByLabelText("Password"), "long-enough-password");
    await user.type(screen.getByLabelText("What should we call you?"), "Sam");
    await user.type(
      screen.getByLabelText(/Where should we reach you\?/),
      "pilot@example.com",
    );

    await user.click(screen.getByRole("button", { name: "Join the pilot" }));

    expect(
      await screen.findByText(/Joining the pilot needs your OK/),
    ).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText(/I have read the information above/));
    expect(pilotApi.pilotEnroll).not.toHaveBeenCalled();
  });

  it("translates an invalid invite code into plain language and focuses the outcome", async () => {
    pilotApi.pilotEnroll.mockRejectedValueOnce(
      new pilotApi.PilotApiError(403, "invalid_invite", "invalid invite code"),
    );
    const user = userEvent.setup();
    render(<PilotEnrollPage />);
    await user.type(screen.getByLabelText("Invite code"), "WRONG-CODE");
    await user.type(screen.getByLabelText("Email", { selector: "input[type=email]" }), "pilot@example.com");
    await user.type(screen.getByLabelText("Password"), "long-enough-password");
    await user.type(screen.getByLabelText("What should we call you?"), "Sam");
    await user.type(
      screen.getByLabelText(/Where should we reach you\?/),
      "pilot@example.com",
    );
    await user.click(screen.getByLabelText(/I have read the information above/));

    await user.click(screen.getByRole("button", { name: "Join the pilot" }));

    expect(await screen.findByText("That invite code isn't valid.")).toBeInTheDocument();
    expect(screen.getByText(/Ask the team for a fresh code|Invite codes come from the Unmute1AI team/)).toBeTruthy();
    // Focus lands on the outcome heading, not on a dead form.
    expect(document.activeElement).toHaveTextContent("Enrollment didn't complete");
  });
});

describe("pilot gate page", () => {
  it("passes axe with no violations", async () => {
    sessionApi.getMe.mockResolvedValueOnce({
      user: { id: "user_admin", email: "f@example.com", role: "admin", displayName: "Founder" },
    });
    pilotApi.listPilotProposals.mockResolvedValueOnce({
      proposals: [PENDING_PROPOSAL, EXECUTED_PROPOSAL],
    });

    const { container } = render(<PilotGatePage />);
    await screen.findByText(/Held and decided actions/);
    const results = await axe.run(container, AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });

  it("shows an admin approval controls for pending proposals, and the executed trail", async () => {
    sessionApi.getMe.mockResolvedValueOnce({
      user: { id: "user_admin", email: "f@example.com", role: "admin", displayName: "Founder" },
    });
    pilotApi.listPilotProposals.mockResolvedValueOnce({
      proposals: [PENDING_PROPOSAL, EXECUTED_PROPOSAL],
    });

    render(<PilotGatePage />);

    await screen.findByText(/Waiting for founder approval/);
    expect(screen.getByText(/Approved and executed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve and execute" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
    expect(screen.getByText(/Result: {"participantCount":3}/)).toBeInTheDocument();
  });

  it("renders state only for non-admins: no approval controls on pending proposals", async () => {
    sessionApi.getMe.mockResolvedValueOnce({
      user: { id: "user_1", email: "p@example.com", role: "pilot_participant", displayName: "Pilot Participant" },
    });
    pilotApi.listPilotProposals.mockResolvedValueOnce({ proposals: [PENDING_PROPOSAL] });

    render(<PilotGatePage />);

    await screen.findByText(/Waiting for founder approval/);
    expect(screen.queryByRole("button", { name: "Approve and execute" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Decline" })).not.toBeInTheDocument();
  });

  it("proposing parks pending state and announces that nothing runs yet", async () => {
    sessionApi.getMe.mockResolvedValue({
      user: { id: "user_1", email: "p@example.com", role: "pilot_participant", displayName: "Pilot Participant" },
    });
    pilotApi.listPilotProposals
      .mockResolvedValueOnce({ proposals: [] })
      .mockResolvedValueOnce({ proposals: [PENDING_PROPOSAL] });
    pilotApi.proposePilotAction.mockResolvedValueOnce({ proposal: PENDING_PROPOSAL });

    const user = userEvent.setup();
    render(<PilotGatePage />);

    await user.click(await screen.findByRole("button", { name: "Propose the demo action" }));

    expect(pilotApi.proposePilotAction).toHaveBeenCalledWith({ action: "export_pilot_report" });
    expect(await screen.findByText(/nothing runs until a founder approves it/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Waiting for founder approval/)).toBeInTheDocument());
  });

  it("reports the server's 409 when a decided proposal is confirmed again — nothing ran twice", async () => {
    sessionApi.getMe.mockResolvedValue({
      user: { id: "user_admin", email: "f@example.com", role: "admin", displayName: "Founder" },
    });
    pilotApi.listPilotProposals.mockResolvedValue({ proposals: [PENDING_PROPOSAL] });
    pilotApi.confirmPilotAction.mockRejectedValueOnce(
      new pilotApi.PilotApiError(409, "proposal_already_resolved", "no claimable proposal"),
    );

    const user = userEvent.setup();
    render(<PilotGatePage />);

    await user.click(await screen.findByRole("button", { name: "Approve and execute" }));

    expect(await screen.findByText(/Nothing ran twice/)).toBeInTheDocument();
  });

  it("reports the server's 403 when a non-founder tries to confirm — the client never decides", async () => {
    sessionApi.getMe.mockResolvedValueOnce({
      user: { id: "user_admin", email: "f@example.com", role: "admin", displayName: "Founder" },
    });
    pilotApi.listPilotProposals.mockResolvedValue({ proposals: [PENDING_PROPOSAL] });
    pilotApi.confirmPilotAction.mockRejectedValueOnce(
      new pilotApi.PilotApiError(403, "forbidden", "not the confirmer"),
    );

    const user = userEvent.setup();
    render(<PilotGatePage />);

    await user.click(await screen.findByRole("button", { name: "Approve and execute" }));

    expect(
      await screen.findByText(/Only a founder other than the person who proposed it/),
    ).toBeInTheDocument();
  });
});
