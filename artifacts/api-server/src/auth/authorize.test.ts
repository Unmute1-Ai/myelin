import { describe, expect, it } from "vitest";
import type { GuardianAccessPort } from "./authorize";
import { authorize, evaluatePolicy, ForbiddenError } from "./authorize";
import type { AuditEntry, AuditPort } from "./audit";
import type { User } from "@workspace/db/schema";
import type { UserRole } from "./schemas";

/**
 * The policy reads only `id` and `role` from the actor, so the fixture
 * fills the rest with placeholders and casts once, here.
 */
function actor(id: string, role: UserRole): User {
  return {
    id,
    role,
    email: `${role}@primer.test`,
    passwordHash: "unused",
    displayName: role,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;
}

/** In-memory audit port capturing every recorded decision. */
function fakeAudit(): AuditPort & { entries: AuditEntry[] } {
  const entries: AuditEntry[] = [];
  return {
    entries,
    async record(entry) {
      entries.push(entry);
    },
  };
}

/** In-memory guardian port — answers come from a test table. */
function guardianPort(answers: {
  accessPairs?: Array<[parentId: string, studentId: string]>;
  links?: Record<string, string>; // linkId -> ownerId
}): GuardianAccessPort {
  return {
    async hasGrantedGuardianAccess(parentId, studentId) {
      return (answers.accessPairs ?? []).some(([p, s]) => p === parentId && s === studentId);
    },
    async getGuardianLink(linkId) {
      const owner = answers.links?.[linkId];
      return owner ? { id: linkId, parentId: owner, status: "granted" as const } : undefined;
    },
  };
}

const PARENT = "p0000000-0000-4000-8000-000000000001";
const STUDENT = "s0000000-0000-4000-8000-000000000002";
const EDUCATOR = "e0000000-0000-4000-8000-000000000003";
const OTHER = "x0000000-0000-4000-8000-000000000004";

describe("evaluatePolicy — fail-closed defaults", () => {
  it("denies by default: a parent without granted guardian access", () => {
    const decision = evaluatePolicy(
      actor(PARENT, "parent"),
      "view_progress",
      { type: "user_data", userId: STUDENT },
      { isSelf: false, hasGuardianAccess: false, isLinkOwner: false },
    );
    expect(decision).toBe("deny");
  });

  it("denies an educator reading another user's progress", () => {
    const decision = evaluatePolicy(
      actor(EDUCATOR, "educator"),
      "view_progress",
      { type: "user_data", userId: STUDENT },
      { isSelf: false, hasGuardianAccess: false, isLinkOwner: false },
    );
    expect(decision).toBe("deny");
  });

  it("denies an admin reading another user's progress — the privacy layer cannot be overridden", () => {
    const decision = evaluatePolicy(
      actor(OTHER, "admin"),
      "view_progress",
      { type: "user_data", userId: STUDENT },
      { isSelf: false, hasGuardianAccess: false, isLinkOwner: false },
    );
    expect(decision).toBe("deny");
  });

  it("denies a student reading someone else's progress", () => {
    const decision = evaluatePolicy(
      actor(STUDENT, "student"),
      "view_progress",
      { type: "user_data", userId: OTHER },
      { isSelf: false, hasGuardianAccess: false, isLinkOwner: false },
    );
    expect(decision).toBe("deny");
  });

  it("denies a parent starting a tutoring session even for themselves", () => {
    const decision = evaluatePolicy(
      actor(PARENT, "parent"),
      "start_session",
      { type: "user_data", userId: PARENT },
      { isSelf: true, hasGuardianAccess: false, isLinkOwner: false },
    );
    expect(decision).toBe("deny");
  });

  it("allows a student to start their own session", () => {
    const decision = evaluatePolicy(
      actor(STUDENT, "student"),
      "start_session",
      { type: "user_data", userId: STUDENT },
      { isSelf: true, hasGuardianAccess: false, isLinkOwner: false },
    );
    expect(decision).toBe("allow");
  });

  it("allows self view and self edit for every role", () => {
    for (const role of ["student", "parent", "educator", "admin"] as const) {
      const view = evaluatePolicy(
        actor(OTHER, role),
        "view_progress",
        { type: "user_data", userId: OTHER },
        { isSelf: true, hasGuardianAccess: false, isLinkOwner: false },
      );
      const edit = evaluatePolicy(
        actor(OTHER, role),
        "edit_profile",
        { type: "user_data", userId: OTHER },
        { isSelf: true, hasGuardianAccess: false, isLinkOwner: false },
      );
      expect(view, role).toBe("allow");
      expect(edit, role).toBe("allow");
    }
  });

  it("allows a parent to view progress only with granted guardian access", () => {
    const withAccess = evaluatePolicy(
      actor(PARENT, "parent"),
      "view_progress",
      { type: "user_data", userId: STUDENT },
      { isSelf: false, hasGuardianAccess: true, isLinkOwner: false },
    );
    expect(withAccess).toBe("allow");

    // Access to progress does not generalize: a parent still cannot edit the
    // student's profile.
    const edit = evaluatePolicy(
      actor(PARENT, "parent"),
      "edit_profile",
      { type: "user_data", userId: STUDENT },
      { isSelf: false, hasGuardianAccess: true, isLinkOwner: false },
    );
    expect(edit).toBe("deny");
  });

  it("allows only the owning parent to manage a guardian link", () => {
    const owner = evaluatePolicy(
      actor(PARENT, "parent"),
      "manage_guardian_link",
      { type: "guardian_link", guardianLinkId: "link-1" },
      { isSelf: false, hasGuardianAccess: false, isLinkOwner: true },
    );
    expect(owner).toBe("allow");

    const stranger = evaluatePolicy(
      actor(OTHER, "parent"),
      "manage_guardian_link",
      { type: "guardian_link", guardianLinkId: "link-1" },
      { isSelf: false, hasGuardianAccess: false, isLinkOwner: false },
    );
    expect(stranger).toBe("deny");
  });
});

describe("authorize", () => {
  it("writes an allowed audit row and resolves when policy allows", async () => {
    const audit = fakeAudit();
    await authorize(
      actor(STUDENT, "student"),
      "start_session",
      { type: "user_data", userId: STUDENT },
      { audit, guardianAccess: guardianPort({}) },
    );

    expect(audit.entries).toHaveLength(1);
    const entry = audit.entries[0]!;
    expect(entry.decision).toBe("allowed");
    expect(entry.action).toBe("start_session");
    expect(entry.resourceType).toBe("user_data");
    expect(entry.resourceId).toBe(STUDENT);
    expect(entry.authorizationEvidence).toMatchObject({
      role: "student",
      isSelf: true,
      hasGuardianAccess: false,
    });
  });

  it("writes a denied audit row and throws ForbiddenError", async () => {
    const audit = fakeAudit();

    await expect(
      authorize(
        actor(PARENT, "parent"),
        "view_progress",
        { type: "user_data", userId: STUDENT },
        // No access pair recorded — the consent trail is the authority.
        { audit, guardianAccess: guardianPort({}) },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]!.decision).toBe("denied");
    expect(audit.entries[0]!.action).toBe("view_progress");
    expect(audit.entries[0]!.authorizationEvidence).toMatchObject({
      role: "parent",
      hasGuardianAccess: false,
    });
  });

  it("resolves guardian-link ownership through the port, not the client", async () => {
    const audit = fakeAudit();

    await expect(
      authorize(
        actor(OTHER, "parent"),
        "manage_guardian_link",
        { type: "guardian_link", guardianLinkId: "link-1" },
        { audit, guardianAccess: guardianPort({ links: { "link-1": PARENT } }) },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      authorize(
        actor(PARENT, "parent"),
        "manage_guardian_link",
        { type: "guardian_link", guardianLinkId: "link-1" },
        { audit, guardianAccess: guardianPort({ links: { "link-1": PARENT } }) },
      ),
    ).resolves.toBeUndefined();
  });

  it("fails closed when the audit write itself fails", async () => {
    // An allowed decision must still not pass if the trail can't be written.
    const failingAudit: AuditPort = {
      async record() {
        throw new Error("audit write failed");
      },
    };

    await expect(
      authorize(
        actor(STUDENT, "student"),
        "start_session",
        { type: "user_data", userId: STUDENT },
        { audit: failingAudit, guardianAccess: guardianPort({}) },
      ),
    ).rejects.toThrow("audit write failed");
  });
});
