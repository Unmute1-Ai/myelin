// Pilot API schemas (zod/v4, the hand-written validator universe — the same
// one auth/schemas.ts uses). The generated @workspace/api-zod package only
// knows the contract in lib/api-spec/openapi.yaml; the pilot surface is new
// and hand-rolled until it graduates into the spec.

import { z } from "zod/v4";
import { PublicUser } from "../auth/schemas";

// ── The data-flow disclosure ───────────────────────────────────────────────
// Server-owned and stored verbatim on every enrollment row: what is stored,
// what leaves the device, who sees it. The client renders this text BEFORE
// the consent checkbox; the row keeps exactly what was in force.

export const DATA_FLOW_DISCLOSURE = [
  "What we store: the name, email, and contact preference you give us; your",
  "accessibility settings; and a record of what you do in the app (for",
  "example, tutoring sessions and which answers you got right).",
  "",
  "What leaves your device: everything you type goes to our server over an",
  "encrypted connection. The pilot never uses your camera or microphone, so",
  "no video or audio ever leaves your device.",
  "",
  "Who sees it: only the Unmute1AI pilot team. We never sell or share your",
  "data, and you can ask us to delete it at any time by writing to the",
  "founder.",
].join("\n");

export const CONSENT_VERSION = "pilot-2026-11-26";

/** Accessibility preference fields, aligned with the accessibility_prefs columns. */
export const PilotAccessibilityPrefs = z.object({
  captionsEnabled: z.boolean().default(true),
  textSize: z.enum(["small", "medium", "large", "xlarge"]).default("medium"),
  aacInputEnabled: z.boolean().default(false),
  reducedMotion: z.boolean().default(false),
});

export type PilotAccessibilityPrefs = z.infer<typeof PilotAccessibilityPrefs>;

// ── Invites ────────────────────────────────────────────────────────────────

export const CreatePilotInviteBody = z.object({
  note: z.string().trim().max(500).default(""),
  expiresInDays: z.number().int().min(1).max(90).default(14),
});

export const PilotInviteView = z.object({
  id: z.uuid(),
  code: z.string(),
  note: z.string(),
  expiresAt: z.string().nullable(),
  usedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type PilotInviteView = z.infer<typeof PilotInviteView>;

export const PilotInviteResponse = z.object({ invite: PilotInviteView });

// ── Enrollment ─────────────────────────────────────────────────────────────

export const PilotEnrollBody = z.object({
  code: z.string().trim().min(6, "Enter the invite code you were given.").max(64),
  email: z.email().max(320),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
  displayName: z.string().trim().min(1).max(120),
  contactMethod: z.enum(["email", "sms", "asl_video_relay"]),
  contactValue: z.string().trim().min(1, "Tell us where to reach you.").max(200),
  accessibility: PilotAccessibilityPrefs.default({
    captionsEnabled: true,
    textSize: "medium",
    aacInputEnabled: false,
    reducedMotion: false,
  }),
  consent: z.object({
    consentToParticipate: z.literal(true, {
      message: "Participating in the pilot requires your consent.",
    }),
    consentToLearningData: z.boolean(),
    consentVersion: z.string().trim().min(1).max(50),
  }),
});

export type PilotEnrollBody = z.infer<typeof PilotEnrollBody>;

export const PilotEnrollmentView = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  contactMethod: z.string(),
  contactValue: z.string(),
  accessibility: PilotAccessibilityPrefs,
  consent: z.object({
    consentToParticipate: z.boolean(),
    consentToLearningData: z.boolean(),
    consentVersion: z.string(),
    dataFlowDisclosure: z.string(),
  }),
  source: z.string(),
  createdAt: z.string(),
});
export type PilotEnrollmentView = z.infer<typeof PilotEnrollmentView>;

export const PilotEnrollResponse = z.object({
  user: PublicUser,
  enrollment: PilotEnrollmentView,
});

export const PilotEnrollmentsResponse = z.object({
  enrollments: z.array(
    z.object({
      enrollment: PilotEnrollmentView,
      participant: z.object({
        id: z.uuid(),
        displayName: z.string(),
        email: z.string(),
      }),
    }),
  ),
});

// ── The generalized gate demo ──────────────────────────────────────────────

/** The demo consequential action — the only gated action on the pilot surface. */
export const DEMO_GATED_ACTION = "export_pilot_report";

export const PROPOSE_PILOT_ACTION_BODY = z.object({
  action: z.literal(DEMO_GATED_ACTION),
});

export const PILOT_CHECK_LINE =
  "Export the pilot report? Nothing runs until a founder approves it.";

export const ConfirmPilotActionBody = z.object({
  accepted: z.boolean(),
});

export const ProposalIdParams = z.object({ proposalId: z.uuid() });

export const PilotProposalView = z.object({
  id: z.uuid(),
  action: z.string(),
  status: z.enum(["pending", "executed", "declined"]),
  checkLine: z.string(),
  proposedBy: z.string().nullable(),
  proposedByName: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});
export type PilotProposalView = z.infer<typeof PilotProposalView>;

export const PilotProposalsResponse = z.object({
  proposals: z.array(PilotProposalView),
});

export const PilotProposalResponse = z.object({ proposal: PilotProposalView });
