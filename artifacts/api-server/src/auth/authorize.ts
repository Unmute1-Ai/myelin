import type { AuditPort } from "./audit";
import type { UserRole } from "./schemas";

/**
 * The authorization boundary (spec §6.1). Every mutating or data-revealing
 * route runs behind `authorize()`, which denies by default and writes an
 * audit row for the decision — allow or deny — before returning or throwing.
 */

export type AuthAction =
  | "view_progress"
  | "edit_profile"
  | "start_session"
  | "export_data"
  | "manage_guardian_link";

export type ProtectedResource =
  | { type: "user_data"; userId: string }
  | { type: "guardian_link"; guardianLinkId: string };

export interface PolicyFacts {
  /** The actor is accessing their own record. */
  isSelf: boolean;
  /** Actor is a parent holding a granted link + unrevoked guardian_access consent. */
  hasGuardianAccess: boolean;
  /** Actor is the parent who owns this guardian link. */
  isLinkOwner: boolean;
}

export type PolicyDecision = "allow" | "deny";

/**
 * Pure decision table — deny is the default; every allow is an explicit rule.
 * Roles with no rule (educator, admin on child data) fall through to deny:
 * no one overrides the authorization layer (spec §6.10).
 */
export function evaluatePolicy(
  actor: { id: string; role: UserRole },
  action: AuthAction,
  resource: ProtectedResource,
  facts: PolicyFacts,
): PolicyDecision {
  if (resource.type === "guardian_link") {
    return action === "manage_guardian_link" && facts.isLinkOwner ? "allow" : "deny";
  }

  if (!facts.isSelf) {
    // Parents may view a linked student's progress — with recorded consent
    // only, and nothing more (no edit, no export, no session start).
    return action === "view_progress" && actor.role === "parent" && facts.hasGuardianAccess
      ? "allow"
      : "deny";
  }

  if (action === "start_session") return actor.role === "student" ? "allow" : "deny";
  return "allow"; // view_progress / edit_profile / export_data on your own record
}

export class ForbiddenError extends Error {
  constructor(message = "You don't have access to this resource.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export interface GuardianLinkFacts {
  id: string;
  parentId: string;
  status: "pending" | "granted" | "revoked";
}

export interface GuardianAccessPort {
  /** Granted link + unrevoked guardian_access consent — the consent trail is the authority. */
  hasGrantedGuardianAccess(parentId: string, studentId: string): Promise<boolean>;
  getGuardianLink(linkId: string): Promise<GuardianLinkFacts | undefined>;
}

export interface AuthorizeDeps {
  audit: AuditPort;
  guardianAccess: GuardianAccessPort;
}

/**
 * The one authorization boundary. Resolves the policy facts, records the
 * audit row, then throws ForbiddenError on deny. A failed audit write fails
 * the request — an allow is never granted without its evidence trail.
 */
export async function authorize(
  actor: { id: string; role: UserRole },
  action: AuthAction,
  resource: ProtectedResource,
  deps: AuthorizeDeps,
): Promise<void> {
  const facts: PolicyFacts =
    resource.type === "guardian_link"
      ? {
          isSelf: false,
          hasGuardianAccess: false,
          isLinkOwner:
            (await deps.guardianAccess.getGuardianLink(resource.guardianLinkId))?.parentId ===
            actor.id,
        }
      : {
          isSelf: actor.id === resource.userId,
          hasGuardianAccess:
            actor.role === "parent" &&
            (await deps.guardianAccess.hasGrantedGuardianAccess(actor.id, resource.userId)),
          isLinkOwner: false,
        };

  const decision = evaluatePolicy(actor, action, resource, facts);

  await deps.audit.record({
    actorId: actor.id,
    action,
    resourceType: resource.type,
    resourceId: resource.type === "guardian_link" ? resource.guardianLinkId : resource.userId,
    decision: decision === "allow" ? "allowed" : "denied",
    authorizationEvidence: { role: actor.role, ...facts },
  });

  if (decision === "deny") throw new ForbiddenError();
}
