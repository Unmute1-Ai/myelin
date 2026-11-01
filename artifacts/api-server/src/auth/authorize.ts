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
  | "manage_guardian_link"
  | "manage_educator_link"
  | "assign_work"
  | "configure_supports";

export type ProtectedResource =
  | { type: "user_data"; userId: string }
  | { type: "guardian_link"; guardianLinkId: string }
  | { type: "educator_link"; educatorLinkId: string };

export interface PolicyFacts {
  /** The actor is accessing their own record. */
  isSelf: boolean;
  /** Actor is a parent holding a granted link + unrevoked guardian_access consent. */
  hasGuardianAccess: boolean;
  /** Actor is the parent who owns this guardian link. */
  isLinkOwner: boolean;
  /** Actor is an educator holding an admin-granted link to this student. */
  hasEducatorAccess?: boolean;
  /** Actor is the educator who owns this educator link. */
  isEducatorLinkOwner?: boolean;
}

export type PolicyDecision = "allow" | "deny";

/**
 * Pure decision table — deny is the default; every allow is an explicit rule.
 * Roles with no rule fall through to deny: no one overrides the authorization
 * layer (spec §6.10). Notably, admins have no child-data read rule either —
 * approving an educator link is not a license to browse learning records.
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

  if (resource.type === "educator_link") {
    // Granting or revoking an educator link is the human authorization
    // decision: admins act on any link; an educator only ever manages their
    // own (e.g. revoking a link they no longer need). Grant routes
    // additionally gate on the admin role — defense in depth.
    return action === "manage_educator_link" &&
      (actor.role === "admin" || facts.isEducatorLinkOwner === true)
      ? "allow"
      : "deny";
  }

  if (!facts.isSelf) {
    // Educators may view a linked student's progress and assign work /
    // configure supports — with an admin-granted link only, and nothing
    // more: never edit_profile (the student owns their record), never
    // export_data, never start_session.
    if (
      actor.role === "educator" &&
      facts.hasEducatorAccess === true &&
      (action === "view_progress" ||
        action === "assign_work" ||
        action === "configure_supports")
    ) {
      return "allow";
    }
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

export interface EducatorLinkFacts {
  id: string;
  educatorId: string;
  status: "pending" | "granted" | "revoked";
}

export interface EducatorAccessPort {
  /** A live admin-granted link between this educator and student. */
  hasActiveEducatorLink(educatorId: string, studentId: string): Promise<boolean>;
  getEducatorLink(linkId: string): Promise<EducatorLinkFacts | undefined>;
}

export interface AuthorizeDeps {
  audit: AuditPort;
  guardianAccess: GuardianAccessPort;
  /**
   * Optional so routes on paths that never touch educator links need not
   * wire it — omitting it fails closed for educators (no port, no access).
   */
  educatorAccess?: EducatorAccessPort;
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
      : resource.type === "educator_link"
        ? {
            isSelf: false,
            hasGuardianAccess: false,
            isLinkOwner: false,
            isEducatorLinkOwner:
              (await deps.educatorAccess?.getEducatorLink(resource.educatorLinkId))
                ?.educatorId === actor.id,
          }
        : {
            isSelf: actor.id === resource.userId,
            hasGuardianAccess:
              actor.role === "parent" &&
              (await deps.guardianAccess.hasGrantedGuardianAccess(actor.id, resource.userId)),
            isLinkOwner: false,
            hasEducatorAccess:
              actor.role === "educator" &&
              (await deps.educatorAccess?.hasActiveEducatorLink(actor.id, resource.userId)) ===
                true,
          };

  const decision = evaluatePolicy(actor, action, resource, facts);

  await deps.audit.record({
    actorId: actor.id,
    action,
    resourceType: resource.type,
    resourceId:
      resource.type === "guardian_link"
        ? resource.guardianLinkId
        : resource.type === "educator_link"
          ? resource.educatorLinkId
          : resource.userId,
    decision: decision === "allow" ? "allowed" : "denied",
    authorizationEvidence: { role: actor.role, ...facts },
  });

  if (decision === "deny") throw new ForbiddenError();
}
