// Integration tests: the adaptive engine wrapped over the scripted provider,
// driven the way the tutor routes drive it (ProviderDriver = the route's
// contract minus HTTP). Proves the whole chain — learner evidence in, strategy
// turn out, why_changed written through the port, Sentinel untouched.

import { describe, expect, it } from "vitest";
import type { Assessment } from "@workspace/db/schema";
import { DEMO_LESSON } from "../lesson/money-math";
import { createScriptedProvider } from "../provider/scripted";
import { ProviderDriver } from "../eval/harness";
import {
  createAdaptiveProvider,
  lastStrategyId,
  type AdaptiveContextPort,
  type AdaptiveLearningContext,
} from "./engine";
import type { StrategyChangeRecord } from "./why-changed";

const STUDENT_ID = "11111111-1111-1111-1111-111111111111";

function assessmentRow(overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: crypto.randomUUID(),
    studentId: STUDENT_ID,
    sessionId: null,
    turnId: null,
    subject: "math.money",
    skill: "pennies",
    level: "recognition",
    evidenceKind: "recall",
    evidenceNote: "recognized the right answer on a practiced problem",
    createdAt: new Date(),
    ...overrides,
  };
}

/** Recall plateau: 3 correct answers on practiced problems, zero independent evidence. */
const PLATEAU_ROWS: readonly Assessment[] = Array.from({ length: 3 }, () => assessmentRow());

function learnerContext(overrides: Partial<AdaptiveLearningContext> = {}): AdaptiveLearningContext {
  return {
    profile: { preferredStrategy: null, pacing: "standard", subjects: ["math.money"] },
    assessments: [...PLATEAU_ROWS],
    ...overrides,
  };
}

/** Fake port: fixed context, captured strategy-change notes. */
function fakePort(
  context: AdaptiveLearningContext | null,
  notes: StrategyChangeRecord[] = [],
  loadError: unknown = null,
): AdaptiveContextPort {
  return {
    load: async () => {
      if (loadError !== null) throw loadError;
      return context;
    },
    recordStrategyChange: async (_sessionId, change) => {
      notes.push(change);
    },
  };
}

function adaptiveDriver(context: AdaptiveLearningContext | null, notes: StrategyChangeRecord[] = [], loadError: unknown = null) {
  const provider = createAdaptiveProvider({ base: createScriptedProvider(), port: fakePort(context, notes, loadError) });
  return new ProviderDriver(provider);
}

function scriptedDriver() {
  return new ProviderDriver(createScriptedProvider());
}

const FIRST_STRUGGLE = "i don't know";
const SECOND_STRUGGLE = "no idea, sorry";

describe("adaptive engine — delegation preserves the base provider", () => {
  it("with no learner context, scripted behavior is byte-for-byte identical", async () => {
    const plain = scriptedDriver();
    const wrapped = adaptiveDriver(null);

    for (const input of ["hello", FIRST_STRUGGLE, SECOND_STRUGGLE]) {
      const expected = await plain.turn(input);
      const actual = await wrapped.turn(input);
      expect(actual.reply).toBe(expected.reply);
      expect(actual.strategyId).toBe(expected.strategyId); // both null — no strategy turns
    }
  });

  it("a correct answer still flows to the Sentinel gate: propose, never execute", async () => {
    const notes: StrategyChangeRecord[] = [];
    const driver = adaptiveDriver(learnerContext(), notes);
    await driver.turn("hello");

    const turn = await driver.turn(String(DEMO_LESSON.steps[0]!.check.acceptedNumbers[0]));
    expect(turn.proposedAction).toBe("advance_step");
    expect(turn.strategyId).toBeNull(); // delegated — grading turns carry no strategy
    expect(notes).toEqual([]); // no strategy change happened
    expect(driver.progress.stepIndex).toBe(0); // nothing executed without confirm

    const confirmed = driver.confirm(true);
    expect(confirmed.executed).toBe(true);
    expect(driver.progress.stepIndex).toBe(1);
  });

  it("an opening teaching turn is delegated untouched", async () => {
    const driver = adaptiveDriver(learnerContext());
    const turn = await driver.turn("hello");
    expect(turn.kind).toBe("teach");
    expect(turn.strategyId).toBeNull();
  });
});

describe("adaptive engine — struggle adapts through strategy selection", () => {
  it("a struggling learner gets an evidence-fitted strategy turn, tagged with its id", async () => {
    const driver = adaptiveDriver(learnerContext());
    await driver.turn("hello");

    const turn = await driver.turn(FIRST_STRUGGLE);
    expect(turn.strategyId).toBe("visual"); // recall plateau's best fit
    expect(turn.kind).toBe("reteach");
    expect(turn.proposedAction).toBeNull(); // strategies propose nothing
    expect(turn.reply).toContain(DEMO_LESSON.steps[0]!.check.question);
    expect(driver.progress.stepIndex).toBe(0); // never moves position
  });

  it("the FIRST strategy pick is not a change — no why_changed is written", async () => {
    const notes: StrategyChangeRecord[] = [];
    const driver = adaptiveDriver(learnerContext(), notes);
    await driver.turn("hello");
    await driver.turn(FIRST_STRUGGLE);
    expect(notes).toEqual([]);
  });

  it("a second struggle adapts away from the previous strategy and writes why_changed through the port", async () => {
    const notes: StrategyChangeRecord[] = [];
    const driver = adaptiveDriver(learnerContext(), notes);
    await driver.turn("hello");
    const first = await driver.turn(FIRST_STRUGGLE); // visual
    const second = await driver.turn(SECOND_STRUGGLE); // no-repeat → example_based

    expect(second.strategyId).toBe("example_based");
    expect(second.strategyId).not.toBe(first.strategyId);
    expect(second.reply).not.toBe(first.reply); // genuinely different attempt
    expect(second.reply).toContain(DEMO_LESSON.steps[0]!.check.question);

    // The engine-made change is explained on the learner's record — through
    // the §6.2 seam, with the gap's own evidence reason in the note.
    expect(notes.length).toBe(1);
    const note = notes[0]!;
    expect(note.detail).toContain("worked example"); // the approach it switched to
    expect(note.whyChanged).toContain("a worked example this time"); // names the new approach…
    expect(note.whyChanged).toContain("correct answers on practiced problems"); // …and cites the gap's evidence reason
    expect(note.subject).toBe("math.money");
  });

  it("the no-repeat rule holds across delegated turns — the last strategy turn is the reference", async () => {
    const driver = adaptiveDriver(learnerContext());
    await driver.turn("hello");
    await driver.turn(FIRST_STRUGGLE); // visual
    const answer = String(DEMO_LESSON.steps[0]!.check.acceptedNumbers[0]);
    await driver.turn(answer); // delegated (proposal)
    driver.confirm(true); // advance — delegated teaching of step 2

    const later = await driver.turn(FIRST_STRUGGLE); // stuck on the NEW step
    expect(later.strategyId).toBe("example_based"); // still not visual
    expect(lastStrategyId(driver.history)).toBe("example_based");
  });

  it("selection stays deterministic across sessions — same evidence, same words", async () => {
    const run = async () => {
      const driver = adaptiveDriver(learnerContext());
      await driver.turn("hello");
      const first = await driver.turn(FIRST_STRUGGLE);
      const second = await driver.turn(SECOND_STRUGGLE);
      return [first.reply, second.reply];
    };
    expect(await run()).toEqual(await run());
  });
});

describe("adaptive engine — the learner's own controls", () => {
  it("an explicit explain-differently ask overrides selection and never repeats the previous strategy", async () => {
    const notes: StrategyChangeRecord[] = [];
    const driver = adaptiveDriver(learnerContext(), notes);
    await driver.turn("hello");
    const first = await driver.turn(FIRST_STRUGGLE); // visual
    const asked = await driver.turn("can you explain that differently?");

    expect(asked.strategyId).not.toBe(first.strategyId);
    expect(asked.reply).not.toBe(first.reply);
    expect(asked.reply).toContain(DEMO_LESSON.steps[0]!.check.question);
    expect(asked.proposedAction).toBeNull();
    // The learner asked — the engine writes no note on their record.
    expect(notes).toEqual([]);
  });

  it("the override works with NO evidence at all — always available", async () => {
    const driver = adaptiveDriver(learnerContext({ assessments: [] }));
    await driver.turn("hello");
    const asked = await driver.turn("say it differently please");
    expect(asked.strategyId).not.toBeNull();
    expect(asked.reply).toContain(DEMO_LESSON.steps[0]!.check.question);
  });

  it("an explicit standing preference wins over evidence and may repeat — the student asked for it", async () => {
    const notes: StrategyChangeRecord[] = [];
    const context = learnerContext({ profile: { preferredStrategy: "socratic", pacing: "standard", subjects: ["math.money"] } });
    const driver = adaptiveDriver(context, notes);
    await driver.turn("hello");

    const first = await driver.turn(FIRST_STRUGGLE);
    const second = await driver.turn(SECOND_STRUGGLE);
    expect(first.strategyId).toBe("socratic"); // preference beats the plateau's visual pull
    expect(second.strategyId).toBe("socratic"); // standing pick is the student asking
    expect(notes).toEqual([]); // learner-initiated — nothing recorded
  });
});

describe("adaptive engine — graceful degradation", () => {
  it("a port failure never takes the learner's lesson down — base provider answers", async () => {
    const driver = adaptiveDriver(learnerContext(), [], new Error("database unreachable"));
    await driver.turn("hello");
    const plain = scriptedDriver();
    await plain.turn("hello");

    const turn = await driver.turn(FIRST_STRUGGLE);
    const expected = await plain.turn(FIRST_STRUGGLE);
    expect(turn.reply).toBe(expected.reply); // scripted stuck reply, no strategy turn
    expect(turn.strategyId).toBeNull();
  });
});

describe("lastStrategyId", () => {
  it("reads the most recent strategy-tagged tutor message, skipping learner and untagged messages", () => {
    const history = [
      { role: "tutor" as const, content: "a", stepId: "pennies", kind: "teach" as const },
      { role: "learner" as const, content: "b" },
      { role: "tutor" as const, content: "c", stepId: "pennies", kind: "reteach" as const, strategyId: "visual" },
      { role: "learner" as const, content: "d" },
    ];
    expect(lastStrategyId(history)).toBe("visual");
    expect(lastStrategyId(history.slice(0, 2))).toBeNull();
  });
});
