// The audit vocabulary (spec §6.11: "every consequential action" is audited).
// Routes record through these constants instead of inline strings, so a new
// consequential action declares its audit name here first — and the
// completeness tests can enumerate what the trail must be able to show.

/** Authorization-decision actions recorded by `authorize()` (allow AND deny). */
export const AUTHORIZATION_ACTIONS = [
  "view_progress",
  "edit_profile",
  "start_session",
  "export_data",
  "manage_guardian_link",
] as const;

/**
 * Completed consequential actions — things that happened, not merely gate
 * decisions. Every mutating route records one of these after it succeeds;
 * denials record the authorization action with decision "denied".
 */
export const CONSEQUENTIAL_ACTIONS = [
  // Identity and session lifecycle
  "register",
  "login",
  "login_failed",
  "logout",
  // Guardian consent chain
  "create_guardian_link",
  "record_consent",
  "revoke_guardian_link",
  // Learning record
  "update_learning_profile",
  "create_profile_entry",
  "delete_profile_entry",
  // Preferences
  "update_accessibility_prefs",
  // Tutoring sessions and materials
  "create_session",
  "delete_session",
  "upload_material",
  // Sentinel lifecycle (model-generated actions)
  "tutor_action_proposed",
  "tutor_action_confirmed",
  "tutor_action_declined",
  // Privacy operations
  "retention_sweep_executed",
  // Role-gate refusals (requireRole)
  "route_access",
] as const;

export type ConsequentialAction = (typeof CONSEQUENTIAL_ACTIONS)[number];

/** Typed constant map so route call sites autocomplete and typo-check. */
export const AuditAction = Object.fromEntries(
  CONSEQUENTIAL_ACTIONS.map((action) => [action, action]),
) as { [K in ConsequentialAction]: K };

/**
 * Actions the retention sweep must never touch: the trail itself is
 * append-only, and its rows carry resource ids and decision evidence, never
 * learner content — the audit trail is not data-minimized away.
 */
export const RETENTION_IMMUNE_ACTIONS: readonly ConsequentialAction[] = CONSEQUENTIAL_ACTIONS;
