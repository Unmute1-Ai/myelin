// Sentinel boundary unit tests (spec §6.11, §7 row 11). The propose →
// deny-until-confirm → execute-on-confirm → audit-row suite, run against the
// generalized module with fake ports — the same invariants the platform
// route tests verify over HTTP, stated once here at the boundary itself.

import { describe, expect, it, vi } from "vitest";
import type { AuditEntry, AuditPort } from "../auth/audit";
import { parkProposal, resolveProposal, type PendingProposal, type ProposalPark } from "./sentinel";

function recordingAudit(): { port: AuditPort; rows: AuditEntry[] } {
  const rows: AuditEntry[] = [];
  return {
    rows,
    port: {
      record: vi.fn((entry: AuditEntry) => {
        rows.push(entry);
        return Promise.resolve();
      }),
    },
  };
}

const proposal: PendingProposal = { action: "advance_step", checkLine: "Shall we move on?" };

/** In-memory pending slot with atomic take — mirrors SessionDataPort.consumePending. */
function fakeSlot(): ProposalPark & { take(): PendingProposal | null; parked(): PendingProposal | null } {
  let slot: PendingProposal | null = null;
  return {
    park(pending) {
      slot = pending;
    },
    take() {
      const pending = slot;
      slot = null;
      return pending;
    },
    parked: () => slot,
  };
}

describe("parkProposal", () => {
  it("parks the proposal and audits it — nothing executes", async () => {
    const slot = fakeSlot();
    const { port, rows } = recordingAudit();

    await parkProposal(slot, proposal, port, { resourceType: "tutoring_session", resourceId: "s-1" }, "actor-1");

    expect(slot.parked()).toEqual(proposal);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: "actor-1",
      action: "tutor_action_proposed",
      resourceType: "tutoring_session",
      resourceId: "s-1",
      decision: "allowed",
      authorizationEvidence: { action: "advance_step", gated: true },
    });
  });

  it("keeps parking when the actor is anonymous (demo paths)", async () => {
    const slot = fakeSlot();
    const { port, rows } = recordingAudit();

    await parkProposal(slot, proposal, port, { resourceType: "tutoring_session", resourceId: null }, null);

    expect(slot.parked()).toEqual(proposal);
    expect(rows[0]!.actorId).toBeNull();
  });
});

describe("resolveProposal — deny until confirm", () => {
  it("declines without executing and audits the refusal", async () => {
    const slot = fakeSlot();
    await slot.park(proposal);
    const { port, rows } = recordingAudit();
    const execute = vi.fn();

    const outcome = await resolveProposal({
      consumer: { consume: () => slot.take() },
      accepted: false,
      actorId: "actor-1",
      resource: { resourceType: "tutoring_session", resourceId: "s-1" },
      audit: port,
      execute,
    });

    expect(outcome).toEqual({ status: "declined" });
    expect(execute).not.toHaveBeenCalled();
    expect(slot.parked()).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "tutor_action_declined",
      decision: "allowed",
      authorizationEvidence: { action: "advance_step", accepted: false },
    });
  });

  it("executes exactly once on explicit confirmation and audits the execution", async () => {
    const slot = fakeSlot();
    await slot.park(proposal);
    const { port, rows } = recordingAudit();
    const execute = vi.fn((pending: PendingProposal) => Promise.resolve({ advanced: pending.action }));

    const outcome = await resolveProposal({
      consumer: { consume: () => slot.take() },
      accepted: true,
      actorId: "actor-1",
      resource: { resourceType: "tutoring_session", resourceId: "s-1" },
      audit: port,
      execute,
    });

    expect(outcome).toEqual({ status: "executed", result: { advanced: "advance_step" } });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(proposal);
    expect(slot.parked()).toBeNull(); // exactly-once: consumed before execution
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "tutor_action_confirmed",
      decision: "allowed",
      authorizationEvidence: { action: "advance_step", accepted: true, executed: true },
    });
  });

  it("resolves no_pending when nothing is parked — a confirm the model never made cannot execute", async () => {
    const slot = fakeSlot();
    const { port, rows } = recordingAudit();
    const execute = vi.fn();

    const outcome = await resolveProposal({
      consumer: { consume: () => slot.take() },
      accepted: true,
      actorId: "actor-1",
      resource: { resourceType: "tutoring_session", resourceId: "s-1" },
      audit: port,
      execute,
    });

    expect(outcome).toEqual({ status: "no_pending" });
    expect(execute).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0); // nothing happened, nothing to audit
  });

  it("never executes twice — the second resolution finds the slot empty", async () => {
    const slot = fakeSlot();
    await slot.park(proposal);
    const { port } = recordingAudit();
    const execute = vi.fn(() => Promise.resolve("ok"));

    const first = await resolveProposal({
      consumer: { consume: () => slot.take() },
      accepted: true,
      actorId: "actor-1",
      resource: { resourceType: "tutoring_session", resourceId: "s-1" },
      audit: port,
      execute,
    });
    const second = await resolveProposal({
      consumer: { consume: () => slot.take() },
      accepted: true,
      actorId: "actor-1",
      resource: { resourceType: "tutoring_session", resourceId: "s-1" },
      audit: port,
      execute,
    });

    expect(first.status).toBe("executed");
    expect(second.status).toBe("no_pending");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("leaves the trail honest when execution fails — the proposal row shows no execution", async () => {
    const slot = fakeSlot();
    await slot.park(proposal);
    const { port, rows } = recordingAudit();

    await expect(
      resolveProposal({
        consumer: { consume: () => slot.take() },
        accepted: true,
        actorId: "actor-1",
        resource: { resourceType: "tutoring_session", resourceId: "s-1" },
        audit: port,
        execute: () => Promise.reject(new Error("storage down")),
      }),
    ).rejects.toThrow("storage down");

    expect(rows.some((row) => row.action === "tutor_action_confirmed")).toBe(false);
    expect(slot.parked()).toBeNull(); // consumed — a failed execution cannot be re-run blind
  });
});
