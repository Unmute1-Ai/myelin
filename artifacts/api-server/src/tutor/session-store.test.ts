// Unit tests for the session store: Sentinel exactly-once semantics, TTL
// expiry (fake clock), and wipe behavior.

import { describe, expect, it } from "vitest";
import { MASTERED_MARKER } from "./types";
import { SessionNotFoundError, SessionStore } from "./session-store";

function makeStore() {
  let now = 1_000_000;
  const store = new SessionStore(() => now);
  return { store, tick: (ms: number) => { now += ms; } };
}

describe("SessionStore", () => {
  it("executes a pending action exactly once via consumeConfirmed", () => {
    const { store } = makeStore();
    const session = store.create();

    expect(store.consumeConfirmed(session, true)).toBeNull(); // nothing pending

    store.setPendingAction(session, { action: "advance_step", checkLine: "I heard this as: ready?" });
    const executed = store.consumeConfirmed(session, true);
    expect(executed).toEqual({ action: "advance_step", checkLine: "I heard this as: ready?" });
    expect(store.consumeConfirmed(session, true)).toBeNull(); // exactly once
  });

  it("never executes on a falsy confirmation", () => {
    const { store } = makeStore();
    const session = store.create();
    store.setPendingAction(session, { action: "mark_mastered", checkLine: "check" });
    expect(store.consumeConfirmed(session, false)).toBeNull();
    // Still pending — a decline (clearPendingAction) is what drops it.
    expect(store.consumeConfirmed(session, true)).not.toBeNull();
  });

  it("expires sessions after ~2h of inactivity", () => {
    const { store, tick } = makeStore();
    const session = store.create();

    tick(2 * 60 * 60 * 1000 - 1000);
    expect(store.get(session.id)).toBe(session); // still alive

    tick(2000);
    expect(() => store.get(session.id)).toThrow(SessionNotFoundError); // expired

    const fresh = store.create();
    tick(1000);
    store.pushTurn(fresh, "hi", { role: "tutor", content: "hello" });
    expect(store.get(fresh.id).history).toHaveLength(2); // activity refreshes TTL
  });

  it("appends advance markers and flips mastered on the special marker", () => {
    const { store } = makeStore();
    const session = store.create();
    store.markAdvanced(session, "pennies");
    store.markAdvanced(session, "pennies");
    // Markers are append-only history; position derivation is set-based, so
    // duplicate markers are harmless.
    expect(session.history.filter((m) => m.kind === "advance" && m.stepId === "pennies")).toHaveLength(2);
    expect(session.mastered).toBe(false);

    store.markAdvanced(session, MASTERED_MARKER);
    expect(session.mastered).toBe(true);
  });

  it("deletes sessions", () => {
    const { store } = makeStore();
    const session = store.create();
    expect(store.delete(session.id)).toBe(true);
    expect(store.delete(session.id)).toBe(false);
    expect(() => store.get(session.id)).toThrow(SessionNotFoundError);
  });
});
