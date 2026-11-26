/*
 * Typed client for the pilot endpoints (U1Si-Q pilot: enrollment + gate).
 * Hand-rolled like session-api.ts because these routes are not yet in the
 * OpenAPI contract (lib/api-spec/openapi.yaml) — when they graduate to the
 * spec, the generated @workspace/api-zod validators replace these shapes.
 *
 * All calls are same-origin `/api/...`: next.config.ts rewrites the prefix to
 * the Express API, so the httpOnly session cookie rides along. The client
 * RENDERS gate state only — every enforcement decision (invite validity,
 * roles, exactly-once execution) lives on the server.
 */

/** A failed API call with the API's own error envelope, when one arrived. */
export class PilotApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "PilotApiError";
    this.status = status;
    this.code = code;
  }
}

async function pilotFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    ...init,
  });

  if (!response.ok) {
    let code: string | null = null;
    let message = `Request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { code?: string; message?: string };
      code = body.code ?? null;
      message = body.message ?? message;
    } catch {
      // Non-JSON error body — keep the status-based fallback message.
    }
    throw new PilotApiError(response.status, code, message);
  }

  return (await response.json()) as T;
}

// ── Shapes (mirror the server's zod responses; not yet in the OpenAPI spec) ─

export interface PilotInvite {
  id: string;
  code: string;
  note: string;
  expiresAt: string | null;
  usedAt: string | null;
  createdAt: string;
}

export interface PilotEnrollmentView {
  id: string;
  userId: string;
  contactMethod: string;
  contactValue: string;
  accessibility: {
    captionsEnabled: boolean;
    textSize: string;
    aacInputEnabled: boolean;
    reducedMotion: boolean;
  };
  consent: {
    consentToParticipate: boolean;
    consentToLearningData: boolean;
    consentVersion: string;
    dataFlowDisclosure: string;
  };
  source: string;
  createdAt: string;
}

export interface PilotProposal {
  id: string;
  action: string;
  status: "pending" | "executed" | "declined";
  checkLine: string;
  proposedBy: string | null;
  proposedByName: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  result: Record<string, unknown> | null;
  createdAt: string;
}

export interface EnrollInput {
  code: string;
  email: string;
  password: string;
  displayName: string;
  contactMethod: "email" | "sms" | "asl_video_relay";
  contactValue: string;
  accessibility: {
    captionsEnabled: boolean;
    textSize: "small" | "medium" | "large" | "xlarge";
    aacInputEnabled: boolean;
    reducedMotion: boolean;
  };
  consent: { consentToParticipate: true; consentToLearningData: boolean; consentVersion: string };
}

// ── Calls ────────────────────────────────────────────────────────────────────

/** Founder/admin issues an invite code. 403 for anyone else. */
export function createPilotInvite(body: { note: string; expiresInDays: number }) {
  return pilotFetch<{ invite: PilotInvite }>("/api/pilot/invites", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Self-serve enrollment with a founder-issued code. Sets the session cookie on success. */
export function pilotEnroll(body: EnrollInput) {
  return pilotFetch<{ user: { id: string; role: string }; enrollment: PilotEnrollmentView }>(
    "/api/pilot/enroll",
    { method: "POST", body: JSON.stringify(body) },
  );
}

/** Founder/admin only — the enrollment list. */
export function listPilotEnrollments() {
  return pilotFetch<{
    enrollments: Array<{ participant: { id: string; displayName: string; email: string }; enrollment: PilotEnrollmentView }>;
  }>("/api/pilot/enrollments");
}

/** Propose the demo consequential action. Parks pending state; executes nothing. */
export function proposePilotAction(body: { action: "export_pilot_report" }) {
  return pilotFetch<{ proposal: PilotProposal }>("/api/pilot/proposals", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Held and decided actions. Admins see all; others see their own proposals. */
export function listPilotProposals() {
  return pilotFetch<{ proposals: PilotProposal[] }>("/api/pilot/proposals");
}

/**
 * The human decision: accept executes exactly once (server-enforced via the
 * atomic claim); decline consumes the proposal with nothing executed. 403 for
 * non-admins and for the proposer; 409 when nothing is claimable.
 */
export function confirmPilotAction(proposalId: string, body: { accepted: boolean }) {
  return pilotFetch<{ proposal: PilotProposal }>(
    `/api/pilot/proposals/${encodeURIComponent(proposalId)}/confirm`,
    { method: "POST", body: JSON.stringify(body) },
  );
}
