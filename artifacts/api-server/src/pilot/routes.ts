// Pilot routes (U1Si-Q pilot): invite-code enrollment and the generalized
// Sentinel gate demo. Two invariants carry over from the platform spine:
//
//   1. Self-serve registration requires a valid, unexpired, unused invite
//      code — the founder issues codes; the server consumes them atomically.
//   2. A gated proposal parks as pending state (pilot_proposals row) and
//      executes nothing on its own. Only POST /proposals/:id/confirm with
//      accepted:true executes — exactly once, via the atomic claim — and the
//      route's authorize() runs first: admin only, never the proposer.
//
// The web client renders gate state; it is never the enforcement point.

import { randomBytes } from "node:crypto";
import { Router, type Response, type RequestHandler, type IRouter } from "express";
import type { User } from "@workspace/db/schema";
import { authorize, type PilotProposalAccessPort } from "../auth/authorize";
import { requireAuth, requireRole, type AuthedRequest } from "../auth/middleware";
import { defaultAuthDeps, type AuthDeps } from "../auth/deps";
import { publicUser } from "../auth/schemas";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "../auth/session";
import { parseBody, parseParams, type ApiErrorCode } from "../lib/http";
import {
  parkProposal,
  resolveProposal,
  PILOT_AUDIT_ACTIONS,
} from "../sentinel/sentinel";
import {
  CreatePilotInviteBody,
  ConfirmPilotActionBody,
  DATA_FLOW_DISCLOSURE,
  DEMO_GATED_ACTION,
  PILOT_CHECK_LINE,
  PilotEnrollResponse,
  PilotEnrollmentsResponse,
  PilotEnrollBody,
  PilotInviteResponse,
  PilotInviteView,
  PilotProposalResponse,
  PilotProposalsResponse,
  ProposalIdParams,
  PROPOSE_PILOT_ACTION_BODY,
  type PilotProposalView,
} from "./schemas";
import {
  drizzlePilotPort,
  executePilotReport,
  type PilotPort,
} from "./pilot-service";

/** 4xx/5xx with the platform error shape; never logs payload values. */
function sendPilotError(res: Response, status: number, code: ApiErrorCode, message: string): void {
  res.status(status).json({ code, message });
}

/** A URL-safe invite code: 144 bits of crypto randomness, no ambiguous glyphs. */
function generateInviteCode(): string {
  return randomBytes(18).toString("base64url");
}

function inviteView(invite: {
  id: string;
  code: string;
  note: string;
  expiresAt: Date | null;
  usedAt: Date | null;
  createdAt: Date;
}): PilotInviteView {
  return {
    id: invite.id,
    code: invite.code,
    note: invite.note,
    expiresAt: invite.expiresAt?.toISOString() ?? null,
    usedAt: invite.usedAt?.toISOString() ?? null,
    createdAt: invite.createdAt.toISOString(),
  };
}

function proposalView(row: {
  proposal: {
    id: string;
    action: string;
    status: "pending" | "executed" | "declined";
    checkLine: string;
    proposedBy: string | null;
    decidedBy: string | null;
    decidedAt: Date | null;
    result: Record<string, unknown> | null;
    createdAt: Date;
  };
  proposedByName: string | null;
  decidedByName: string | null;
}): PilotProposalView {
  return {
    id: row.proposal.id,
    action: row.proposal.action,
    status: row.proposal.status,
    checkLine: row.proposal.checkLine,
    proposedBy: row.proposal.proposedBy,
    proposedByName: row.proposedByName,
    decidedBy: row.proposal.decidedBy,
    decidedByName: row.decidedByName,
    decidedAt: row.proposal.decidedAt?.toISOString() ?? null,
    result: row.proposal.result,
    createdAt: row.proposal.createdAt.toISOString(),
  };
}

export interface PilotDeps extends AuthDeps {
  pilot: PilotPort;
  authenticate?: RequestHandler;
}

/** Production wiring: real auth deps plus the Drizzle pilot port. */
export function defaultPilotDeps(): PilotDeps {
  const auth = defaultAuthDeps();
  return {
    ...auth,
    pilot: drizzlePilotPort(auth.db),
  };
}

export function createPilotRoutes(deps: PilotDeps = defaultPilotDeps()): IRouter {
  const router: IRouter = Router();
  const authenticate = deps.authenticate ?? requireAuth(deps);

  // The authorize() pilot-proposal fact: who proposed it (the party that can
  // never confirm it). Built on the same port the routes use.
  const pilotProposalAccess: PilotProposalAccessPort = {
    getProposalProposer: (proposalId) => deps.pilot.getProposalProposer(proposalId),
  };

  // ── Invites (founder/admin issues codes) ─────────────────────────────────

  router.post("/invites", authenticate, requireRole(deps, "admin"), async (req, res) => {
    const user = (req as AuthedRequest).user;
    const body = parseBody(req, res, CreatePilotInviteBody);
    if (body === undefined) return;

    const invite = await deps.pilot.createInvite({
      code: generateInviteCode(),
      issuedBy: user.id,
      note: body.note,
      expiresAt: new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000),
    });
    await deps.audit.record({
      actorId: user.id,
      action: "pilot_invite_issued",
      resourceType: "pilot_invite",
      resourceId: invite.id,
      decision: "allowed",
      authorizationEvidence: { role: user.role, expiresInDays: body.expiresInDays },
    });
    res.status(201).json(PilotInviteResponse.parse({ invite: inviteView(invite) }));
  });

  // ── Enrollment (self-serve with a valid code) ────────────────────────────

  router.post("/enroll", async (req, res) => {
    const body = parseBody(req, res, PilotEnrollBody);
    if (body === undefined) return;

    const outcome = await deps.pilot.enroll({
      inviteCode: body.code,
      email: body.email,
      passwordHash: await deps.passwords.hash(body.password),
      displayName: body.displayName,
      contactMethod: body.contactMethod,
      contactValue: body.contactValue,
      accessibility: body.accessibility,
      consentToLearningData: body.consent.consentToLearningData,
      consentVersion: body.consent.consentVersion,
      // The server's canonical disclosure is stored, not the client's copy.
      dataFlowDisclosure: DATA_FLOW_DISCLOSURE,
    });

    if (outcome.kind === "invalid_invite") {
      sendPilotError(res, 403, "invalid_invite", "That invite code isn't valid. Check it and try again.");
      return;
    }
    if (outcome.kind === "invite_expired") {
      sendPilotError(res, 410, "invite_expired", "That invite code has expired. Ask the team for a new one.");
      return;
    }
    if (outcome.kind === "invite_used") {
      sendPilotError(res, 409, "invite_already_used", "That invite code has already been used.");
      return;
    }
    if (outcome.kind === "email_registered") {
      sendPilotError(res, 409, "email_already_registered", "That email already has an account. Try logging in instead.");
      return;
    }

    const user: User = outcome.user;
    await deps.audit.record({
      actorId: user.id,
      action: "pilot_enrolled",
      resourceType: "pilot_enrollment",
      resourceId: outcome.enrollment.id,
      decision: "allowed",
      authorizationEvidence: {
        role: user.role,
        inviteId: outcome.enrollment.inviteId,
        consentVersion: body.consent.consentVersion,
      },
    });

    const token = deps.codec.sign({ userId: user.id, role: user.role });
    res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions());
    res.status(201).json(
      PilotEnrollResponse.parse({
        user: publicUser(user),
        enrollment: {
          id: outcome.enrollment.id,
          userId: outcome.enrollment.userId,
          contactMethod: outcome.enrollment.contactMethod,
          contactValue: outcome.enrollment.contactValue,
          accessibility: {
            captionsEnabled: outcome.enrollment.captionsEnabled,
            textSize: outcome.enrollment.textSize,
            aacInputEnabled: outcome.enrollment.aacInputEnabled,
            reducedMotion: outcome.enrollment.reducedMotion,
          },
          consent: {
            consentToParticipate: outcome.enrollment.consentToParticipate,
            consentToLearningData: outcome.enrollment.consentToLearningData,
            consentVersion: outcome.enrollment.consentVersion,
            dataFlowDisclosure: outcome.enrollment.dataFlowDisclosure,
          },
          source: outcome.enrollment.source,
          createdAt: outcome.enrollment.createdAt.toISOString(),
        },
      }),
    );
  });

  // ── Enrollment list (founder/admin only, audited refusals) ───────────────

  router.get("/enrollments", authenticate, requireRole(deps, "admin"), async (_req, res) => {
    const enrollments = await deps.pilot.listEnrollments();
    res.json(
      PilotEnrollmentsResponse.parse({
        enrollments: enrollments.map(({ enrollment, participant }) => ({
          participant,
          enrollment: {
            id: enrollment.id,
            userId: enrollment.userId,
            contactMethod: enrollment.contactMethod,
            contactValue: enrollment.contactValue,
            accessibility: {
              captionsEnabled: enrollment.captionsEnabled,
              textSize: enrollment.textSize,
              aacInputEnabled: enrollment.aacInputEnabled,
              reducedMotion: enrollment.reducedMotion,
            },
            consent: {
              consentToParticipate: enrollment.consentToParticipate,
              consentToLearningData: enrollment.consentToLearningData,
              consentVersion: enrollment.consentVersion,
              dataFlowDisclosure: enrollment.dataFlowDisclosure,
            },
            source: enrollment.source,
            createdAt: enrollment.createdAt.toISOString(),
          },
        })),
      }),
    );
  });

  // ── The generalized gate demo ────────────────────────────────────────────

  // Propose: parks pending state. No execution happens here, ever.
  router.post("/proposals", authenticate, async (req, res) => {
    const user = (req as AuthedRequest).user;
    const body = parseBody(req, res, PROPOSE_PILOT_ACTION_BODY);
    if (body === undefined) return;

    const proposal = await deps.pilot.createProposal({
      action: body.action,
      checkLine: PILOT_CHECK_LINE,
      proposedBy: user.id,
    });
    await parkProposal(
      { park: () => Promise.resolve() }, // the row insert above IS the park
      { action: body.action, checkLine: PILOT_CHECK_LINE },
      deps.audit,
      { resourceType: "pilot_proposal", resourceId: proposal.id },
      user.id,
      PILOT_AUDIT_ACTIONS,
    );
    res.status(201).json(
      PilotProposalResponse.parse({
        proposal: proposalView({ proposal, proposedByName: user.displayName, decidedByName: null }),
      }),
    );
  });

  // The audit view: held and decided actions, newest first. Admins see all;
  // everyone else sees their own proposals only.
  router.get("/proposals", authenticate, async (req, res) => {
    const user = (req as AuthedRequest).user;
    const all = await deps.pilot.listProposals();
    const visible = user.role === "admin" ? all : all.filter((row) => row.proposal.proposedBy === user.id);
    res.json(PilotProposalsResponse.parse({ proposals: visible.map(proposalView) }));
  });

  // Confirm: the Sentinel execution path. authorize() runs first — admin
  // only, and never the proposer (interpretation is not authorization).
  router.post("/proposals/:proposalId/confirm", authenticate, async (req, res) => {
    const user = (req as AuthedRequest).user;
    const params = parseParams(req, res, ProposalIdParams);
    if (params === undefined) return;
    const body = parseBody(req, res, ConfirmPilotActionBody);
    if (body === undefined) return;

    const proposal = await deps.pilot.getProposal(params.proposalId);
    if (proposal === undefined) {
      sendPilotError(res, 404, "not_found", "That proposal doesn't exist.");
      return;
    }

    await authorize(user, "confirm_gated_action", { type: "pilot_proposal", proposalId: params.proposalId }, {
      ...deps,
      pilotProposalAccess,
    });

    // Atomic claim + Sentinel resolution: the claim is the exactly-once
    // consume; the second confirm finds nothing claimable and lands in 409.
    const outcome = await resolveProposal({
      consumer: {
        consume: async () => {
          const claimed = await deps.pilot.claimPendingProposal(params.proposalId);
          if (claimed === undefined) return null;
          return { action: claimed.action as typeof DEMO_GATED_ACTION, checkLine: claimed.checkLine };
        },
      },
      accepted: body.accepted,
      actorId: user.id,
      resource: { resourceType: "pilot_proposal", resourceId: params.proposalId },
      audit: deps.audit,
      auditActions: PILOT_AUDIT_ACTIONS,
      execute: async () => {
        // The one execution path for the confirmed demo action.
        return executePilotReport(deps.db);
      },
    });

    if (outcome.status === "no_pending") {
      sendPilotError(res, 409, "no_pending_action", "Nothing is waiting on a confirmation right now.");
      return;
    }

    // Finalize the claimed row: the claim set consumedAt (the exactly-once
    // moment); this write records the decision itself. A crash between claim
    // and finalize shows a claimed-but-undecided proposal in the trail — the
    // documented crash window, never a silent double execution.
    if (outcome.status === "declined") {
      await deps.pilot.markDeclined(params.proposalId, user.id);
    } else {
      await deps.pilot.markExecuted(params.proposalId, user.id, outcome.result);
    }

    // Re-read through the list so the response carries the real proposer and
    // decider names — the trail, not just the state.
    const [updated] = (await deps.pilot.listProposals()).filter(
      (row) => row.proposal.id === params.proposalId,
    );
    if (updated === undefined) {
      sendPilotError(res, 404, "not_found", "That proposal doesn't exist.");
      return;
    }

    res.json(PilotProposalResponse.parse({ proposal: proposalView(updated) }));
  });

  return router;
}
