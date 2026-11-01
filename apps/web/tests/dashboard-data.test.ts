import { describe, expect, it } from "vitest";
import {
  MASTERY_LADDER,
  deriveLearningObjectives,
  deriveMasteryLadder,
  deriveRecommendations,
  findResumeSession,
} from "@/lib/dashboard-data";
import { ProfileEntryKind, ProgressEventKind, SessionStatus, MasteryLevel } from "@workspace/api-zod";
import { makeEntry, makeProfile, makeProgressEvent, makeSession } from "./fixtures";

describe("deriveMasteryLadder", () => {
  it("counts assessment events per rung and keeps the evidence points", () => {
    const events = [
      makeProgressEvent(),
      makeProgressEvent({
        id: "pe-2",
        payload: { level: MasteryLevel.memorization },
      }),
      makeProgressEvent({
        id: "pe-3",
        kind: ProgressEventKind.strategy_changed,
        summary: "Strategy changed to visual",
      }),
    ];

    const ladder = deriveMasteryLadder(events);
    expect(ladder.counts[MasteryLevel.comprehension]).toBe(1);
    expect(ladder.counts[MasteryLevel.memorization]).toBe(1);
    expect(ladder.counts[MasteryLevel.mastery]).toBe(0);
    expect(ladder.evidence).toHaveLength(2);
    expect(ladder.evidence[0]?.summary).toContain("Assessment recorded");
  });

  it("skips assessment events whose payload level is not a mastery level — no invented rungs", () => {
    const ladder = deriveMasteryLadder([
      makeProgressEvent({ payload: { level: "expert-mode" } }),
      makeProgressEvent({ payload: {} }),
    ]);
    expect(Object.values(ladder.counts).reduce((a, b) => a + b, 0)).toBe(0);
    expect(ladder.evidence).toHaveLength(0);
  });

  it("ignores non-assessment events entirely", () => {
    const ladder = deriveMasteryLadder([
      makeProgressEvent({ kind: ProgressEventKind.milestone_reached }),
    ]);
    expect(ladder.evidence).toHaveLength(0);
  });
});

describe("deriveLearningObjectives", () => {
  it("lists profile subjects with gap focus and entry counts", () => {
    const profile = makeProfile({ subjects: ["Money math", "Fractions"] });
    const entries = [
      makeEntry({ id: "e1", kind: ProfileEntryKind.gap, subject: "Money math", detail: "Mixes up nickels and dimes" }),
      makeEntry({ id: "e2", kind: ProfileEntryKind.preference, subject: "Money math", detail: "Likes pictures" }),
    ];

    const objectives = deriveLearningObjectives(profile, entries);
    expect(objectives).toEqual([
      { subject: "Money math", focus: "Mixes up nickels and dimes", evidenceCount: 2 },
      { subject: "Fractions", focus: null, evidenceCount: 0 },
    ]);
  });

  it("surfaces subjects that appear only through evidence, never hiding them", () => {
    const profile = makeProfile({ subjects: [] });
    const entries = [
      makeEntry({ kind: ProfileEntryKind.successful_approach, subject: "Time telling", detail: "Analog clocks clicked" }),
    ];
    const objectives = deriveLearningObjectives(profile, entries);
    expect(objectives.map((o) => o.subject)).toEqual(["Time telling"]);
  });
});

describe("deriveRecommendations", () => {
  it("recommends practice for a gap and a different explanation for a misconception", () => {
    const entries = [
      makeEntry({ id: "g1", kind: ProfileEntryKind.gap, subject: "Money math", detail: "Counts coins out loud, still misses totals" }),
      makeEntry({ id: "m1", kind: ProfileEntryKind.misconception, subject: "Fractions", detail: "Believes bigger denominator means bigger piece" }),
    ];
    const recs = deriveRecommendations(makeProfile(), entries);
    expect(recs.map((r) => r.title)).toEqual([
      "Practice: Money math",
      "Try a different explanation: Fractions",
    ]);
    expect(recs[0]?.reason).toBe("Counts coins out loud, still misses totals");
  });

  it("invites a first step when there are no gaps but the student chose subjects", () => {
    const recs = deriveRecommendations(makeProfile({ subjects: ["Money math"] }), []);
    expect(recs).toHaveLength(1);
    expect(recs[0]?.title).toContain("Money math");
  });

  it("recommends nothing when there is no data — never invents one", () => {
    expect(deriveRecommendations(makeProfile({ subjects: [] }), [])).toEqual([]);
  });
});

describe("findResumeSession", () => {
  it("returns the most recently active session", () => {
    const older = makeSession({ id: "old", lastTurnAt: "2026-10-01T09:00:00Z" });
    const newer = makeSession({ id: "new", lastTurnAt: "2026-10-03T09:30:00Z" });
    expect(findResumeSession([older, newer])?.id).toBe("new");
  });

  it("prefers active sessions and orders by lastTurnAt over startedAt", () => {
    const completedRecent = makeSession({
      id: "done",
      status: SessionStatus.completed,
      startedAt: new Date("2026-10-05T09:00:00Z"),
      lastTurnAt: "2026-10-05T10:00:00Z",
    });
    const activeOlderStart = makeSession({
      id: "live",
      startedAt: new Date("2026-10-03T09:00:00Z"),
      lastTurnAt: "2026-10-03T09:30:00Z",
    });
    expect(findResumeSession([completedRecent, activeOlderStart])?.id).toBe("live");
  });

  it("falls back to startedAt when lastTurnAt is null", () => {
    const a = makeSession({ id: "a", startedAt: new Date("2026-10-01T09:00:00Z"), lastTurnAt: null });
    const b = makeSession({ id: "b", startedAt: new Date("2026-10-02T09:00:00Z"), lastTurnAt: null });
    expect(findResumeSession([a, b])?.id).toBe("b");
  });

  it("returns null with no active sessions", () => {
    const done = makeSession({ status: SessionStatus.completed });
    expect(findResumeSession([done])).toBeNull();
    expect(findResumeSession([])).toBeNull();
  });
});

describe("MASTERY_LADDER", () => {
  it("orders the rungs lowest to highest", () => {
    expect(MASTERY_LADDER).toEqual([
      MasteryLevel.memorization,
      MasteryLevel.recognition,
      MasteryLevel.comprehension,
      MasteryLevel.application,
      MasteryLevel.mastery,
    ]);
  });
});
