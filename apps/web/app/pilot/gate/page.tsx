"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card } from "@/components/ui";
import { getMe } from "@/lib/session-api";
import {
  PilotApiError,
  confirmPilotAction,
  listPilotProposals,
  proposePilotAction,
  type PilotProposal,
} from "@/lib/pilot-api";

/*
 * The generalized Sentinel gate demo (U1Si-Q). The spine this page rides:
 *
 *   propose  → the action parks as pending state on the server; nothing runs
 *   approve  → a founder (admin) who is NOT the proposer confirms; the
 *              server executes exactly once via an atomic claim
 *   decline  → the proposal is consumed with nothing executed
 *
 * This page RENDERS state only. It cannot execute anything: confirm/decline
 * are ordinary requests the server refuses (403, audited) unless the actor is
 * an admin other than the proposer, and a second confirm always lands in 409.
 * The trail below shows held and decided actions — every proposal the model
 * made, not just the ones a human answered.
 */

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; proposals: PilotProposal[] };

const ACTION_LABELS: Record<string, string> = {
  export_pilot_report: "Export the pilot report",
};

const STATUS_LABELS: Record<PilotProposal["status"], string> = {
  pending: "⏳ Waiting for founder approval",
  executed: "✅ Approved and executed",
  declined: "🚫 Declined — nothing ran",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function describeTime(iso: string | null): string {
  return iso === null ? "" : new Date(iso).toLocaleString();
}

export default function PilotGatePage() {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [me, setMe] = useState<{ role: string; displayName: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [who, trail] = await Promise.all([getMe(), listPilotProposals()]);
      setMe(who?.user ? { role: who.user.role, displayName: who.user.displayName } : null);
      setLoad({ kind: "ready", proposals: trail.proposals });
    } catch (error) {
      setLoad({
        kind: "error",
        message:
          error instanceof PilotApiError && error.status === 401
            ? "Sign in to see the gate trail."
            : "Can't reach Unmute1AI right now. Check your connection.",
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Announce outcomes and move focus there — the keyboard lands on the news.
  useEffect(() => {
    if (notice !== null) noticeRef.current?.focus();
  }, [notice]);

  async function handlePropose() {
    setNotice(null);
    try {
      await proposePilotAction({ action: "export_pilot_report" });
      setNotice(
        "Proposal sent. It is waiting as pending state — nothing runs until a founder approves it.",
      );
      await refresh();
    } catch (error) {
      setNotice(
        error instanceof PilotApiError
          ? error.message
          : "Can't reach Unmute1AI right now. Check your connection.",
      );
    }
  }

  async function handleConfirm(proposalId: string, accepted: boolean) {
    setBusyId(proposalId);
    setNotice(null);
    try {
      const { proposal } = await confirmPilotAction(proposalId, { accepted });
      setNotice(
        accepted
          ? `Approved. The server executed "${actionLabel(proposal.action)}" exactly once.`
          : "Declined. The proposal was consumed and nothing was executed.",
      );
      await refresh();
    } catch (error) {
      if (error instanceof PilotApiError && error.status === 409) {
        setNotice("Nothing was waiting on a confirmation — it was already decided. Nothing ran twice.");
      } else if (error instanceof PilotApiError && error.status === 403) {
        // The server refused: a non-founder, or the proposer trying to
        // confirm their own proposal. The client never decides this — it
        // just reports the server's answer.
        setNotice("Only a founder other than the person who proposed it can approve this action.");
      } else {
        setNotice(
          error instanceof PilotApiError
            ? error.message
            : "Can't reach Unmute1AI right now. Check your connection.",
        );
      }
    } finally {
      setBusyId(null);
    }
  }

  const isAdmin = me?.role === "admin";

  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">The approval gate</h1>
        <p className="mt-1 text-ink-soft">
          A demo of how Unmute1AI handles consequential actions: an action is proposed, it waits,
          and only a founder&apos;s approval makes it run — exactly once. This page shows the
          trail; the server holds the keys.
        </p>
      </header>

      <div ref={noticeRef} role="status" aria-live="polite" tabIndex={-1} className="outline-none">
        {notice !== null ? (
          <p className="rounded-card border border-line bg-lavender-soft px-4 py-3 text-sm font-bold text-ink">
            {notice}
          </p>
        ) : null}
      </div>

      {load.kind === "loading" ? (
        <p className="text-ink-soft">Loading the trail…</p>
      ) : load.kind === "error" ? (
        <Card>
          <p className="font-bold text-ink">{load.message}</p>
        </Card>
      ) : (
        <>
          <Card>
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-extrabold text-ink">Try the gate</h2>
              <p className="text-sm text-ink-soft">
                Propose &ldquo;{actionLabel("export_pilot_report")}&rdquo;. The demo action is
                harmless — it reads back how many people enrolled — but it runs through the same
                gate any consequential action would: nothing happens until someone else approves it.
              </p>
              {me === null ? (
                <p className="text-sm text-ink-soft">Sign in to propose actions.</p>
              ) : (
                <div>
                  <Button onClick={handlePropose}>Propose the demo action</Button>
                </div>
              )}
            </div>
          </Card>

          <section aria-labelledby="trail-heading" className="flex flex-col gap-3">
            <h2 id="trail-heading" className="text-lg font-extrabold text-ink">
              Held and decided actions
            </h2>
            {load.proposals.length === 0 ? (
              <p className="text-ink-soft">No proposals yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {load.proposals.map((proposal) => (
                  <li key={proposal.id}>
                    <Card>
                      <div className="flex flex-col gap-2">
                        <p className="text-base font-bold text-ink">
                          {STATUS_LABELS[proposal.status]} — {actionLabel(proposal.action)}
                        </p>
                        <p className="text-sm text-ink-soft">{proposal.checkLine}</p>
                        <p className="text-sm text-ink-soft">
                          Proposed by {proposal.proposedByName ?? "someone"} on{" "}
                          {describeTime(proposal.createdAt)}
                          {proposal.decidedAt !== null && proposal.decidedByName !== null
                            ? ` · decided by ${proposal.decidedByName} on ${describeTime(proposal.decidedAt)}`
                            : ""}
                        </p>
                        {proposal.status === "executed" && proposal.result !== null ? (
                          <p className="rounded-2xl bg-mascot-soft px-4 py-2 text-sm text-ink">
                            Result: {JSON.stringify(proposal.result)}
                          </p>
                        ) : null}
                        {isAdmin && proposal.status === "pending" ? (
                          <div className="flex gap-3">
                            <Button
                              onClick={() => void handleConfirm(proposal.id, true)}
                              disabled={busyId === proposal.id}
                            >
                              {busyId === proposal.id ? "Working…" : "Approve and execute"}
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => void handleConfirm(proposal.id, false)}
                              disabled={busyId === proposal.id}
                            >
                              Decline
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
