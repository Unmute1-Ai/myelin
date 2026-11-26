// The Sentinel confirmation boundary, generalized platform-wide (spec §6.11,
// U1Si-Q "Interpretation is not authorization"). One module owns the rule so
// every route inherits it instead of re-implementing it:
//
//   1. A model-generated consequential action is a PROPOSAL. It parks as
//      pending state and executes nothing on its own.
//   2. Only an explicit confirm (accepted:true) executes it — exactly once,
//      through the atomic consumer.
//   3. Every step of that lifecycle is audited: proposed, confirmed+executed,
//      or declined. A proposal the model never made cannot be confirmed; a
//      confirmation cannot execute twice.
//
// What is gated — the classification, so the boundary stays a decision record
// and not folklore:
//
//   GATED   — every `proposed_action` a provider emits (advance_step,
//             mark_mastered, assign_practice). The TurnEvent union is closed,
//             so these are the ONLY model outputs that execute state; they
//             may reach the learner as pending state and nothing more.
//   UNGATED — adaptive strategy re-teaches and their why_changed notes
//             (spec §6.2/§6.4 prescribe the transparent note; they are
//             teaching content and evidence-governed profile writes, not
//             executions) and recall assessments on the learner's own correct
//             answer (learner-generated evidence, level-capped by the DB
//             CHECK and the insert schema — the human acted, the model only
//             graded).
//
// A future model-driven action joins the boundary by adding a proposal path
// through `parkProposal` and an execution path through `resolveProposal` —
// never by executing inline. The audit window between execution and its
// record is the crash window: an execution failure surfaces as a 5xx with
// the error logged, and the trail shows the proposal without an execution.

import type { AuditPort } from "../auth/audit";
import type { AuthAction } from "../auth/authorize";
import type { ProposedAction } from "../tutor/types";

/**
 * Every action that may execute state only through the gate. The tutor's
 * model-emitted `ProposedAction` union is closed, so those are the only
 * provider outputs that execute state; `export_pilot_report` is the platform
 * demo action — a pilot surface exercising the same spine (propose → human
 * approval → exactly-once execution) without the tutor in the loop.
 */
export type GatedAction = ProposedAction | "export_pilot_report";

/**
 * The platform registry of gated actions. Each entry names the authorization
 * action a confirmer must hold on the resource the proposal executes against
 * — the route's `authorize()` call still runs first; this registry is the
 * declaration that the action is model-generated and confirmation-gated.
 */
export const GATED_ACTIONS: Record<GatedAction, { confirmAction: AuthAction }> = {
  advance_step: { confirmAction: "start_session" },
  mark_mastered: { confirmAction: "start_session" },
  assign_practice: { confirmAction: "start_session" },
  export_pilot_report: { confirmAction: "confirm_gated_action" },
};

/** A model-generated consequential action, parked until a human decides. */
export interface PendingProposal {
  readonly action: GatedAction;
  readonly checkLine: string;
}

/** Where a proposal parks — pending state, never execution. */
/**
 * A parked proposal is just `{ action, checkLine }` as far as the Sentinel
 * spine is concerned; each surface (tutor sessions, the pilot gate) narrows
 * `action` to the actions it knows. The generics below keep those narrow
 * types intact across park and resolve instead of widening to GatedAction
 * and forcing call sites to cast.
 */
export interface ProposalPark<
  P extends { action: string; checkLine: string } = PendingProposal,
> {
  park(pending: P): Promise<void> | void;
}

/**
 * Atomic consume: read the pending proposal and clear it in one step, so two
 * confirmations can never both execute the same proposal.
 */
export interface ProposalConsumer<
  P extends { action: string; checkLine: string } = PendingProposal,
> {
  consume(): P | null | Promise<P | null>;
}

export type ProposalResolution<T> =
  | { status: "no_pending" }
  | { status: "declined" }
  | { status: "executed"; result: T };

/**
 * Audit action names for the three lifecycle steps. The tutor paths keep
 * their historical names; the pilot demo names its own so the trail says
 * which surface produced each row.
 */
export interface ProposalAuditActions {
  proposed: string;
  declined: string;
  confirmed: string;
}

export const TUTOR_AUDIT_ACTIONS: ProposalAuditActions = {
  proposed: "tutor_action_proposed",
  declined: "tutor_action_declined",
  confirmed: "tutor_action_confirmed",
};

export const PILOT_AUDIT_ACTIONS: ProposalAuditActions = {
  proposed: "pilot_action_proposed",
  declined: "pilot_action_declined",
  confirmed: "pilot_action_executed",
};

/**
 * Park a model-generated proposal. Writes the pending state and the
 * `tutor_action_proposed` audit row — the trail shows every proposal the
 * model made, not just the ones a human answered.
 */
export async function parkProposal<P extends { action: string; checkLine: string }>(
  park: ProposalPark<P>,
  pending: P,
  audit: AuditPort,
  resource: { resourceType: string; resourceId: string | null },
  actorId: string | null,
  auditActions: ProposalAuditActions = TUTOR_AUDIT_ACTIONS,
): Promise<void> {
  await park.park(pending);
  await audit.record({
    actorId,
    action: auditActions.proposed,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    decision: "allowed",
    authorizationEvidence: { action: pending.action, gated: true },
  });
}

/**
 * Resolve a parked proposal against a human's decision. Decline consumes it
 * with nothing executed; accept runs `execute` exactly once and audits the
 * execution. Both outcomes are audit rows; the caller maps the resolution
 * onto its HTTP shape.
 */
export async function resolveProposal<
  P extends { action: string; checkLine: string },
  T,
>(args: {
  consumer: ProposalConsumer<P>;
  accepted: boolean;
  actorId: string | null;
  resource: { resourceType: string; resourceId: string | null };
  audit: AuditPort;
  execute: (pending: P) => Promise<T>;
  auditActions?: ProposalAuditActions;
}): Promise<ProposalResolution<T>> {
  const auditActions = args.auditActions ?? TUTOR_AUDIT_ACTIONS;
  const pending = await args.consumer.consume();
  if (pending === null) return { status: "no_pending" };

  if (!args.accepted) {
    // The decline itself is an allowed action — the human exercised the
    // refusal the gate exists for. The proposal is consumed; a declined
    // proposal cannot be resurrected or executed later.
    await args.audit.record({
      actorId: args.actorId,
      action: auditActions.declined,
      resourceType: args.resource.resourceType,
      resourceId: args.resource.resourceId,
      decision: "allowed",
      authorizationEvidence: { action: pending.action, accepted: false },
    });
    return { status: "declined" };
  }

  const result = await args.execute(pending);
  await args.audit.record({
    actorId: args.actorId,
    action: auditActions.confirmed,
    resourceType: args.resource.resourceType,
    resourceId: args.resource.resourceId,
    decision: "allowed",
    authorizationEvidence: { action: pending.action, accepted: true, executed: true },
  });
  return { status: "executed", result };
}
