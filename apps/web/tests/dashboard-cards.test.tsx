import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContinueLearningCard } from "@/components/dashboard/continue-learning-card";
import { LearningObjectivesCard } from "@/components/dashboard/learning-objectives-card";
import { MascotWelcomeCard } from "@/components/dashboard/mascot-welcome-card";
import { MasteryEvidenceCard } from "@/components/dashboard/mastery-evidence-card";
import { ProgressTimelineCard } from "@/components/dashboard/progress-timeline-card";
import { RecentSessionsCard } from "@/components/dashboard/recent-sessions-card";
import { RecommendedActivitiesCard } from "@/components/dashboard/recommended-activities-card";
import { SubjectListCard } from "@/components/dashboard/subject-list-card";
import { MasteryLevel, ProfileEntryKind, SessionStatus } from "@workspace/api-zod";
import { deriveLearningObjectives, deriveMasteryLadder, deriveRecommendations } from "@/lib/dashboard-data";
import { expectNoViolations, runAxe } from "./axe";
import { makeEntry, makeProfile, makeProgressEvent, makeSession } from "./fixtures";

describe("MascotWelcomeCard", () => {
  it("greets the learner by display name beside the dashboard art", () => {
    render(<MascotWelcomeCard displayName="Sam" />);
    expect(screen.getByRole("heading", { name: "Sam" })).toBeInTheDocument();
    expect(screen.getByText("Welcome back")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /illustrated learner .* hearing aid/ })).toHaveAttribute(
      "src",
      "/mascot/mascot-light-dashboard.png",
    );
  });

  it("passes axe", async () => {
    const { container } = render(<MascotWelcomeCard displayName="Sam" />);
    expectNoViolations(await runAxe(container));
  });
});

describe("LearningObjectivesCard", () => {
  it("lists objectives with gap focus and evidence counts", () => {
    const profile = makeProfile({ subjects: ["Money math"] });
    const entries = [
      makeEntry({ kind: ProfileEntryKind.gap, subject: "Money math", detail: "Mixes up nickels and dimes" }),
    ];
    render(<LearningObjectivesCard objectives={deriveLearningObjectives(profile, entries)} />);
    expect(screen.getByRole("heading", { name: "Learning objectives" })).toBeInTheDocument();
    expect(screen.getByText("Money math")).toBeInTheDocument();
    expect(screen.getByText(/Mixes up nickels and dimes/)).toBeInTheDocument();
    expect(screen.getByText(/1 entry in/)).toBeInTheDocument();
  });

  it("shows the mascot empty state with no objectives", () => {
    render(<LearningObjectivesCard objectives={[]} />);
    expect(screen.getByText(/haven't picked any subjects yet/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /empty chart/ })).toBeInTheDocument();
  });

  it("passes axe filled and empty", async () => {
    const filled = render(
      <LearningObjectivesCard objectives={deriveLearningObjectives(makeProfile(), [])} />,
    );
    expectNoViolations(await runAxe(filled.container));
    filled.unmount();
    const empty = render(<LearningObjectivesCard objectives={[]} />);
    expectNoViolations(await runAxe(empty.container));
  });
});

describe("ContinueLearningCard", () => {
  it("shows the active session title and last-activity stamp", () => {
    render(<ContinueLearningCard session={makeSession()} />);
    expect(screen.getByRole("heading", { name: "Continue learning" })).toBeInTheDocument();
    expect(screen.getByText("Money math practice")).toBeInTheDocument();
    expect(screen.getByText(/Last activity/)).toBeInTheDocument();
  });

  it("shows the mascot empty state with no sessions", () => {
    render(<ContinueLearningCard session={null} />);
    expect(screen.getByText(/No sessions yet/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /empty speech bubble/ })).toBeInTheDocument();
  });

  it("passes axe filled and empty", async () => {
    const filled = render(<ContinueLearningCard session={makeSession()} />);
    expectNoViolations(await runAxe(filled.container));
    filled.unmount();
    const empty = render(<ContinueLearningCard session={null} />);
    expectNoViolations(await runAxe(empty.container));
  });
});

describe("SubjectListCard", () => {
  it("renders the student's chosen subjects as labeled chips", () => {
    render(<SubjectListCard subjects={["Money math", "Fractions"]} />);
    const list = screen.getByRole("list", { name: "Subjects you chose" });
    expect(list).toHaveTextContent("Money math");
    expect(list).toHaveTextContent("Fractions");
  });

  it("shows the empty state when no subjects are chosen", () => {
    render(<SubjectListCard subjects={[]} />);
    expect(screen.getByText(/No subjects yet/)).toBeInTheDocument();
  });

  it("passes axe filled", async () => {
    const { container } = render(<SubjectListCard subjects={["Money math"]} />);
    expectNoViolations(await runAxe(container));
  });
});

describe("ProgressTimelineCard", () => {
  it("renders each event with a humanized kind, timestamp, and summary", () => {
    const events = [
      makeProgressEvent(),
      makeProgressEvent({
        id: "pe-2",
        kind: "strategy_changed",
        summary: "Trying pictures next",
        createdAt: new Date("2026-10-04T10:00:00Z"),
      }),
    ];
    render(<ProgressTimelineCard events={events} />);
    const timeline = screen.getByRole("list", { name: "Progress timeline" });
    expect(timeline).toHaveTextContent("Assessment recorded for Money math");
    expect(timeline).toHaveTextContent("Trying pictures next");
    expect(screen.getAllByRole("time")).toHaveLength(2);
    expect(screen.getByText("Strategy changed")).toBeInTheDocument();
  });

  it("shows the empty state with no events", () => {
    render(<ProgressTimelineCard events={[]} />);
    expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument();
  });

  it("passes axe filled", async () => {
    const { container } = render(
      <ProgressTimelineCard events={[makeProgressEvent()]} />,
    );
    expectNoViolations(await runAxe(container));
  });
});

describe("MasteryEvidenceCard", () => {
  it("renders rung meters backed by real counts", () => {
    const ladder = deriveMasteryLadder([
      makeProgressEvent(),
      makeProgressEvent({ id: "pe-2", payload: { level: MasteryLevel.comprehension } }),
      makeProgressEvent({ id: "pe-3", payload: { level: MasteryLevel.memorization } }),
    ]);
    render(<MasteryEvidenceCard ladder={ladder} />);
    const group = screen.getByRole("list", { name: "Mastery counts by level" });
    expect(group).toBeInTheDocument();
    const meters = screen.getAllByRole("meter");
    expect(meters).toHaveLength(5);
    expect(meters[0]).toHaveAttribute("aria-valuenow", "1"); // Remembered
    expect(meters[2]).toHaveAttribute("aria-valuenow", "2"); // Understood
    expect(meters[4]).toHaveAttribute("aria-valuenow", "0"); // Mastered
  });

  it("shows the empty state before the first assessment — zeros never pretend to be data", () => {
    const ladder = deriveMasteryLadder([]);
    render(<MasteryEvidenceCard ladder={ladder} />);
    expect(screen.getByText(/mastery ladder fills in/)).toBeInTheDocument();
    expect(screen.queryAllByRole("meter")).toHaveLength(0);
  });

  it("passes axe filled", async () => {
    const ladder = deriveMasteryLadder([makeProgressEvent()]);
    const { container } = render(<MasteryEvidenceCard ladder={ladder} />);
    expectNoViolations(await runAxe(container));
  });
});

describe("RecommendedActivitiesCard", () => {
  it("renders each recommendation with its transparency reason", () => {
    const recs = deriveRecommendations(makeProfile(), [
      makeEntry({ id: "g1", kind: ProfileEntryKind.gap, subject: "Money math", detail: "Coin totals stall" }),
    ]);
    render(<RecommendedActivitiesCard recommendations={recs} />);
    expect(screen.getByRole("heading", { name: "Recommended for you" })).toBeInTheDocument();
    expect(screen.getByText("Practice: Money math")).toBeInTheDocument();
    expect(screen.getByText("Coin totals stall")).toBeInTheDocument();
  });

  it("shows the empty state when nothing can be honestly recommended", () => {
    render(<RecommendedActivitiesCard recommendations={[]} />);
    expect(screen.getByText(/Pick a subject in your profile/)).toBeInTheDocument();
  });

  it("passes axe filled", async () => {
    const { container } = render(
      <RecommendedActivitiesCard
        recommendations={deriveRecommendations(makeProfile(), [])}
      />,
    );
    expectNoViolations(await runAxe(container));
  });
});

describe("RecentSessionsCard", () => {
  it("lists sessions newest first with status and stamps", () => {
    const older = makeSession({
      id: "old",
      title: "Fractions warm-up",
      status: SessionStatus.completed,
      startedAt: new Date("2026-10-01T09:00:00Z"),
      lastTurnAt: "2026-10-01T09:30:00Z",
    });
    const newer = makeSession({ id: "new" });
    render(<RecentSessionsCard sessions={[older, newer]} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Money math practice");
    expect(items[1]).toHaveTextContent("Fractions warm-up");
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("shows the mascot empty state with no sessions", () => {
    render(<RecentSessionsCard sessions={[]} />);
    expect(screen.getByText(/No sessions yet/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /empty chat window/ })).toBeInTheDocument();
  });

  it("passes axe filled", async () => {
    const { container } = render(<RecentSessionsCard sessions={[makeSession()]} />);
    expectNoViolations(await runAxe(container));
  });
});
