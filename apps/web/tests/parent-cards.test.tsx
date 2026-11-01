/*
 * Component tests for the parent dashboard cards (spec §6.9). The cards are
 * presentational over contract-typed props; these tests pin the honest
 * states — granted/pending/revoked roster entries, evidence-backed mastery
 * rows, metadata-only session summaries, quoted activity reasons — and run
 * axe on filled and empty renders.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FamilyRosterCard } from "@/components/parent/family-roster-card";
import { ParentActivitiesCard } from "@/components/parent/parent-activities-card";
import { ParentMasteryCard } from "@/components/parent/parent-mastery-card";
import { ParentSessionsCard } from "@/components/parent/parent-sessions-card";
import { MasteryLevel } from "@workspace/api-zod";
import { expectNoViolations, runAxe } from "./axe";
import {
  makeAtHomeActivity,
  makeMasteryOverview,
  makeParentSessionSummary,
  makeParentStudent,
  makeSubjectMastery,
} from "./fixtures";

describe("FamilyRosterCard", () => {
  it("lists granted and pending links with their honest access state", () => {
    render(
      <FamilyRosterCard
        students={[
          makeParentStudent(),
          makeParentStudent({
            id: "u-student-2",
            displayName: "Alex",
            linkStatus: "pending",
            accessGranted: false,
          }),
          makeParentStudent({
            id: "u-student-3",
            displayName: "Riley",
            linkStatus: "revoked",
            accessGranted: false,
          }),
        ]}
        selectedStudentId="u-student-1"
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: /Sam/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Alex/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Riley/ })).toBeDisabled();
    expect(screen.getByText("Waiting for consent")).toBeInTheDocument();
    expect(screen.getByText("Consent revoked")).toBeInTheDocument();
  });

  it("selects a learner through the callback", async () => {
    const onSelect = vi.fn();
    render(
      <FamilyRosterCard
        students={[makeParentStudent()]}
        selectedStudentId={null}
        onSelect={onSelect}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Sam/ }));
    expect(onSelect).toHaveBeenCalledWith("u-student-1");
  });

  it("passes axe filled", async () => {
    const { container } = render(
      <FamilyRosterCard
        students={[makeParentStudent()]}
        selectedStudentId="u-student-1"
        onSelect={() => undefined}
      />,
    );
    expectNoViolations(await runAxe(container));
  });
});

describe("ParentMasteryCard", () => {
  it("renders per-subject evidence summaries with friendly rung names", () => {
    render(
      <ParentMasteryCard
        overview={makeMasteryOverview({
          subjects: [
            makeSubjectMastery(),
            makeSubjectMastery({
              subject: "Fractions",
              highestLevel: MasteryLevel.mastery,
              evidenceCount: 3,
              lastEvidenceAt: null,
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText("Money math")).toBeInTheDocument();
    expect(screen.getByText("Fractions")).toBeInTheDocument();
    expect(screen.getAllByText("Understood").length).toBeGreaterThan(0);
    expect(screen.getByText("Mastered")).toBeInTheDocument();
    expect(screen.getByText(/2 assessments · latest Oct 30/)).toBeInTheDocument();
    expect(screen.getByText(/3 assessments$/)).toBeInTheDocument();
  });

  it("shows the mascot empty state before the first assessment", () => {
    render(
      <ParentMasteryCard
        overview={makeMasteryOverview({ subjects: [] })}
      />,
    );
    expect(screen.getByText(/nothing to show yet/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /empty chart/ })).toBeInTheDocument();
  });

  it("passes axe filled and empty", async () => {
    const filled = render(<ParentMasteryCard overview={makeMasteryOverview()} />);
    expectNoViolations(await runAxe(filled.container));
    filled.unmount();
    const empty = render(<ParentMasteryCard overview={makeMasteryOverview({ subjects: [] })} />);
    expectNoViolations(await runAxe(empty.container));
  });
});

describe("ParentSessionsCard", () => {
  it("renders summaries with status, timing, and turn counts", () => {
    render(
      <ParentSessionsCard
        summaries={[
          makeParentSessionSummary(),
          makeParentSessionSummary({
            id: "s-2",
            title: null,
            status: "completed",
            turnCount: 1,
            endedAt: "2026-10-04T10:00:00Z",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Money math practice")).toBeInTheDocument();
    expect(screen.getByText("Untitled session")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText(/7 turns/)).toBeInTheDocument();
    expect(screen.getByText(/1 turn · ended/)).toBeInTheDocument();
  });

  it("never renders turn content — the privacy note is always present", () => {
    render(<ParentSessionsCard summaries={[makeParentSessionSummary()]} />);
    expect(screen.getByText(/Summaries only/)).toBeInTheDocument();
  });

  it("shows the mascot empty state with no sessions", () => {
    render(<ParentSessionsCard summaries={[]} />);
    expect(screen.getByText(/No tutoring sessions yet/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /empty chat window/ })).toBeInTheDocument();
  });

  it("passes axe filled and empty", async () => {
    const filled = render(<ParentSessionsCard summaries={[makeParentSessionSummary()]} />);
    expectNoViolations(await runAxe(filled.container));
    filled.unmount();
    const empty = render(<ParentSessionsCard summaries={[]} />);
    expectNoViolations(await runAxe(empty.container));
  });
});

describe("ParentActivitiesCard", () => {
  it("renders suggestions with their quoted reasons", () => {
    render(
      <ParentActivitiesCard
        activities={[
          makeAtHomeActivity(),
          makeAtHomeActivity({
            id: "home-explore-geometry",
            subject: "Geometry",
            title: "Start exploring: Geometry",
            reason: "Geometry is on your learner's list but hasn't been explored yet",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Practice together: Money math")).toBeInTheDocument();
    expect(screen.getByText(/Because: Struggled to compare unlike denominators twice/)).toBeInTheDocument();
    expect(screen.getByText("Start exploring: Geometry")).toBeInTheDocument();
  });

  it("shows an honest empty state with no suggestions", () => {
    render(<ParentActivitiesCard activities={[]} />);
    expect(screen.getByText(/Nothing suggested right now/)).toBeInTheDocument();
  });

  it("passes axe filled and empty", async () => {
    const filled = render(<ParentActivitiesCard activities={[makeAtHomeActivity()]} />);
    expectNoViolations(await runAxe(filled.container));
    filled.unmount();
    const empty = render(<ParentActivitiesCard activities={[]} />);
    expectNoViolations(await runAxe(empty.container));
  });
});
