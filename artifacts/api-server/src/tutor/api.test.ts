// API acceptance tests for the Primer tutor (Primer MVP spec, verification §2):
// fragmented input gets a shame-free reply with no grammar correction; clear
// meaning is never met with a repeat request; a proposed action does not
// advance progress until /confirm and confirm executes exactly once; same
// input → same scripted output; DELETE makes the next turn 404.
// Plus the Sentinel regression: typed/text assent in a turn never executes.

import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import app from "../app";

interface ProgressShape {
  stepIndex: number;
  totalSteps: number;
  lessonComplete: boolean;
  mastered: boolean;
}

interface TurnResponseBody {
  reply: string;
  spoken: string;
  proposedAction?: "advance_step" | "mark_mastered" | "assign_practice";
  checkLine?: string;
  progress: ProgressShape;
}

interface ErrorBody {
  code: string;
  message: string;
}

type TurnResult = { status: number; body: TurnResponseBody | ErrorBody };

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api/tutor`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function createSession(): Promise<string> {
  const res = await fetch(`${baseUrl}/session`, { method: "POST" });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { sessionId: string };
  return body.sessionId;
}

async function turn(sessionId: string, input: string): Promise<TurnResult> {
  const res = await fetch(`${baseUrl}/turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, input }),
  });
  return { status: res.status, body: (await res.json()) as TurnResponseBody | ErrorBody };
}

async function confirm(sessionId: string, accepted: boolean): Promise<{ status: number; body: (TurnResponseBody & { executed: boolean }) | ErrorBody }> {
  const res = await fetch(`${baseUrl}/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, accepted }),
  });
  return { status: res.status, body: (await res.json()) as (TurnResponseBody & { executed: boolean }) | ErrorBody };
}

function isTurnBody(body: TurnResponseBody | ErrorBody): body is TurnResponseBody {
  return typeof (body as TurnResponseBody).reply === "string";
}

/** Shame-free = no grammar correction, no repeat requests, no shame. */
const NEVER_PHRASES = /repeat|say that again|one more time|proper(ly)? english|grammatically|can'?t understand|doesn'?t make sense|wrong way/i;

describe("POST /api/tutor/turn", () => {
  it("greets fragmented input with a helpful, shame-free reply and no grammar correction", async () => {
    const sessionId = await createSession();
    const { status, body } = await turn(sessionId, "cant do this one");

    expect(status).toBe(200);
    expect(isTurnBody(body)).toBe(true);
    if (!isTurnBody(body)) return;

    // Helpful: the opening delivers the first step's teaching and its check.
    expect(body.reply).toContain("How many pennies make 2 cents?");
    expect(body.reply).toContain("A penny is the smallest coin");
    // Shame-free: never corrects the person, never asks to repeat.
    expect(body.reply).not.toMatch(NEVER_PHRASES);
    expect(body.spoken).not.toMatch(NEVER_PHRASES);
  });

  it("answers a fragmented mid-step attempt with warmth, the worked example, and no grammar commentary", async () => {
    const sessionId = await createSession();
    await turn(sessionId, "hi"); // opening delivers step 1

    const { status, body } = await turn(sessionId, "cant do this one");
    expect(status).toBe(200);
    if (!isTurnBody(body)) return;

    expect(body.reply).toContain("How many pennies make 2 cents?");
    expect(body.reply).not.toMatch(NEVER_PHRASES);
    // Re-teaches rather than stalls or scolds.
    expect(body.reply).toContain("A penny is the smallest coin");
    expect(body.proposedAction).toBeUndefined();
  });

  it("never meets clear meaning with a repeat request — it grades and proposes", async () => {
    const sessionId = await createSession();
    await turn(sessionId, "hello"); // step 1 delivered

    const { status, body } = await turn(sessionId, "two");
    expect(status).toBe(200);
    if (!isTurnBody(body)) return;

    expect(body.reply).not.toMatch(NEVER_PHRASES);
    expect(body.reply).toContain("2 pennies, 2 cents");
    expect(body.proposedAction).toBe("advance_step");
    expect(body.checkLine).toMatch(/^I heard this as: /);
  });
});

describe("Sentinel confirmation gate", () => {
  it("does not advance progress until /confirm, then executes exactly once", async () => {
    const sessionId = await createSession();
    await turn(sessionId, "hello"); // step 1

    const proposal = await turn(sessionId, "two");
    if (!isTurnBody(proposal.body)) throw new Error("expected turn body");
    expect(proposal.body.proposedAction).toBe("advance_step");
    // The proposal alone changed nothing.
    expect(proposal.body.progress.stepIndex).toBe(0);

    // Typed/text assent in a turn is NOT an authorization token.
    const assent = await turn(sessionId, "yes go ahead");
    if (!isTurnBody(assent.body)) throw new Error("expected turn body");
    expect(assent.body.progress.stepIndex).toBe(0);
    expect(assent.body.proposedAction).toBeUndefined();

    // Explicit typed confirmation executes it once and delivers the next step.
    const confirmed = await confirm(sessionId, true);
    expect(confirmed.status).toBe(200);
    if ("executed" in confirmed.body) {
      expect(confirmed.body.executed).toBe(true);
      expect(confirmed.body.progress.stepIndex).toBe(1);
    }

    // Second confirm: nothing pending — 409.
    const again = await confirm(sessionId, true);
    expect(again.status).toBe(409);
    if (!("executed" in again.body)) expect(again.body.code).toBe("no_pending_action");
  });

  it("declining clears the pending proposal without executing anything", async () => {
    const sessionId = await createSession();
    await turn(sessionId, "hello");
    await turn(sessionId, "two");

    const declined = await confirm(sessionId, false);
    expect(declined.status).toBe(200);
    if ("executed" in declined.body) {
      expect(declined.body.executed).toBe(false);
      expect(declined.body.progress.stepIndex).toBe(0);
    }

    // Declined proposals are gone — confirming afterwards finds nothing.
    const late = await confirm(sessionId, true);
    expect(late.status).toBe(409);
  });
});

describe("determinism", () => {
  it("yields identical scripted output for the same inputs across sessions", async () => {
    const inputs = ["hello", "cant do this one", "two", "hi", "two"] as const;

    const run = async () => {
      const sessionId = await createSession();
      const responses: Pick<TurnResponseBody, "reply" | "spoken" | "proposedAction" | "checkLine" | "progress">[] = [];
      for (const input of inputs) {
        const { body } = await turn(sessionId, input);
        if (!isTurnBody(body)) throw new Error(`unexpected error body for input "${input}"`);
        responses.push({
          reply: body.reply,
          spoken: body.spoken,
          proposedAction: body.proposedAction,
          checkLine: body.checkLine,
          progress: body.progress,
        });
      }
      return responses;
    };

    const [first, second] = await Promise.all([run(), run()]);
    expect(second).toEqual(first);
  });
});

describe("DELETE /api/tutor/session/:id", () => {
  it("wipes the session so the next turn 404s", async () => {
    const sessionId = await createSession();
    const alive = await turn(sessionId, "hello");
    expect(alive.status).toBe(200);

    const del = await fetch(`${baseUrl}/session/${sessionId}`, { method: "DELETE" });
    expect(del.status).toBe(204);

    const after = await turn(sessionId, "hello again");
    expect(after.status).toBe(404);
    if (!isTurnBody(after.body)) expect(after.body.code).toBe("session_not_found");

    const confirmAfter = await confirm(sessionId, true);
    expect(confirmAfter.status).toBe(404);

    // Deleting an already-deleted session 404s too.
    const reDelete = await fetch(`${baseUrl}/session/${sessionId}`, { method: "DELETE" });
    expect(reDelete.status).toBe(404);
  });
});
