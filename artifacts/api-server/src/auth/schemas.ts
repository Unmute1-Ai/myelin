import { z } from "zod/v4";
import type { User } from "@workspace/db/schema";

/** Role vocabulary is derived from the users table — one source of truth. */
export type UserRole = User["role"];

export const userRoleSchema = z.enum(["student", "parent", "educator", "admin"]);

// ── Requests ────────────────────────────────────────────────────────────────

export const RegisterBody = z.object({
  email: z.email().max(320),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
  displayName: z.string().trim().min(1).max(120),
  role: userRoleSchema,
});

export const LoginBody = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(200),
});

export const CreateGuardianLinkBody = z.object({
  studentEmail: z.email().max(320),
});

export const RecordConsentBody = z.object({
  type: z.enum(["guardian_access", "learning_data"]),
  termsVersion: z.string().trim().min(1).max(50),
});

export const LinkIdParams = z.object({ linkId: z.uuid() });
export const StudentIdParams = z.object({ studentId: z.uuid() });

// ── Responses ───────────────────────────────────────────────────────────────
// Parsing outbound bodies through these schemas is a privacy control: extra
// fields (a password hash, a consent trail detail) are stripped or rejected
// before anything leaves the server.

export const PublicUser = z.object({
  id: z.uuid(),
  email: z.email(),
  role: userRoleSchema,
  displayName: z.string(),
  createdAt: z.string(),
});
export type PublicUser = z.infer<typeof PublicUser>;

export const UserResponse = z.object({ user: PublicUser });

export const ConsentView = z.object({
  id: z.uuid(),
  type: z.enum(["guardian_access", "learning_data"]),
  termsVersion: z.string(),
  grantedAt: z.string(),
  revokedAt: z.string().nullable(),
});
export type ConsentView = z.infer<typeof ConsentView>;

export const GuardianLinkView = z.object({
  id: z.uuid(),
  parentId: z.uuid(),
  studentId: z.uuid(),
  status: z.enum(["pending", "granted", "revoked"]),
  createdAt: z.string(),
  consents: z.array(ConsentView),
});
export type GuardianLinkView = z.infer<typeof GuardianLinkView>;

export const GuardianLinkResponse = z.object({ link: GuardianLinkView });
export const GuardianLinksResponse = z.object({ links: z.array(GuardianLinkView) });
export const ConsentResponse = z.object({
  consent: ConsentView,
  link: GuardianLinkView,
});

export const ProgressResponse = z.object({
  student: z.object({ id: z.uuid(), displayName: z.string() }),
  progressEvents: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum([
        "assessment_recorded",
        "mastery_changed",
        "strategy_changed",
        "session_completed",
        "milestone_reached",
      ]),
      summary: z.string(),
      createdAt: z.string(),
    }),
  ),
  assessments: z.array(
    z.object({
      id: z.uuid(),
      subject: z.string(),
      skill: z.string().nullable(),
      level: z.enum(["memorization", "recognition", "comprehension", "application", "mastery"]),
      evidenceKind: z.enum(["recall", "application", "explanation", "transfer"]),
      evidenceNote: z.string(),
      createdAt: z.string(),
    }),
  ),
});

/** Maps a users row to its wire shape. The password hash never leaves here. */
export function publicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
  };
}
