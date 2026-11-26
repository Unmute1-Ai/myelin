// Pilot enrollment + gated-proposal persistence. The port keeps every
// exactly-once guarantee in a single SQL statement: an invite is consumed
// with `WHERE used_at IS NULL`, a pending proposal is claimed with
// `WHERE status = 'pending' AND consumed_at IS NULL` — so two concurrent
// enrollments (or confirmations) can never both win. Enrollment itself runs
// in one transaction: invite claim, account, and consent row stand or fall
// together.

import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { users, type User } from "@workspace/db/schema";
import {
  pilotEnrollments,
  pilotInvites,
  pilotProposals,
  type PilotEnrollment,
  type PilotInvite,
  type PilotProposal,
} from "@workspace/db/schema";
import type { PilotAccessibilityPrefs } from "./schemas";

export interface PilotEnrollArgs {
  inviteCode: string;
  email: string;
  passwordHash: string;
  displayName: string;
  contactMethod: string;
  contactValue: string;
  accessibility: PilotAccessibilityPrefs;
  consentToLearningData: boolean;
  consentVersion: string;
  dataFlowDisclosure: string;
}

export type EnrollOutcome =
  | { kind: "ok"; user: User; enrollment: PilotEnrollment }
  | { kind: "invalid_invite" }
  | { kind: "invite_expired" }
  | { kind: "invite_used" }
  | { kind: "email_registered" };

export interface PilotPort {
  createInvite(args: {
    code: string;
    issuedBy: string;
    note: string;
    expiresAt: Date | null;
  }): Promise<PilotInvite>;
  enroll(args: PilotEnrollArgs): Promise<EnrollOutcome>;
  listEnrollments(): Promise<
    Array<{ enrollment: PilotEnrollment; participant: { id: string; displayName: string; email: string } }>
  >;
  createProposal(args: {
    action: string;
    checkLine: string;
    proposedBy: string | null;
  }): Promise<PilotProposal>;
  getProposal(proposalId: string): Promise<PilotProposal | undefined>;
  listProposals(): Promise<
    Array<{
      proposal: PilotProposal;
      proposedByName: string | null;
      decidedByName: string | null;
    }>
  >;
  /** Atomic claim of a pending proposal — undefined once claimed or decided. */
  claimPendingProposal(proposalId: string): Promise<PilotProposal | undefined>;
  markDeclined(proposalId: string, decidedBy: string): Promise<void>;
  markExecuted(proposalId: string, decidedBy: string, result: Record<string, unknown>): Promise<void>;
  getProposalProposer(proposalId: string): Promise<string | undefined>;
}

export function drizzlePilotPort(db: () => NodePgDatabase): PilotPort {
  return {
    async createInvite(args) {
      const [invite] = await db()
        .insert(pilotInvites)
        .values({
          code: args.code,
          issuedBy: args.issuedBy,
          note: args.note,
          expiresAt: args.expiresAt,
        })
        .returning();
      return invite!;
    },

    async enroll(args): Promise<EnrollOutcome> {
      return db().transaction(async (tx) => {
        const [invite] = await tx
          .select()
          .from(pilotInvites)
          .where(eq(pilotInvites.code, args.inviteCode))
          .limit(1);
        if (invite === undefined) return { kind: "invalid_invite" };
        if (invite.usedAt !== null) return { kind: "invite_used" };
        if (invite.expiresAt !== null && invite.expiresAt.getTime() <= Date.now()) {
          return { kind: "invite_expired" };
        }

        const [existing] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, args.email))
          .limit(1);
        if (existing) return { kind: "email_registered" };

        // Claim the invite inside the same transaction — the uniqueness of
        // this moment is what makes one invite enroll exactly one person.
        const claimed = await tx
          .update(pilotInvites)
          .set({ usedAt: new Date() })
          .where(and(eq(pilotInvites.id, invite.id), isNull(pilotInvites.usedAt)))
          .returning({ id: pilotInvites.id });
        if (claimed.length === 0) return { kind: "invite_used" };

        const [user] = await tx
          .insert(users)
          .values({
            email: args.email,
            passwordHash: args.passwordHash,
            role: "pilot_participant",
            displayName: args.displayName,
          })
          .returning();

        await tx
          .update(pilotInvites)
          .set({ usedBy: user!.id })
          .where(eq(pilotInvites.id, invite.id));

        const [enrollment] = await tx
          .insert(pilotEnrollments)
          .values({
            userId: user!.id,
            inviteId: invite.id,
            contactMethod: args.contactMethod,
            contactValue: args.contactValue,
            captionsEnabled: args.accessibility.captionsEnabled,
            textSize: args.accessibility.textSize,
            aacInputEnabled: args.accessibility.aacInputEnabled,
            reducedMotion: args.accessibility.reducedMotion,
            consentToParticipate: true,
            consentToLearningData: args.consentToLearningData,
            dataFlowDisclosure: args.dataFlowDisclosure,
            consentVersion: args.consentVersion,
            source: "invite_code",
          })
          .returning();

        return { kind: "ok", user: user!, enrollment: enrollment! };
      });
    },

    async listEnrollments() {
      const rows = await db()
        .select({ enrollment: pilotEnrollments, participant: users })
        .from(pilotEnrollments)
        .innerJoin(users, eq(pilotEnrollments.userId, users.id))
        .orderBy(desc(pilotEnrollments.createdAt));
      return rows.map(({ enrollment, participant }) => ({
        enrollment,
        participant: {
          id: participant.id,
          displayName: participant.displayName,
          email: participant.email,
        },
      }));
    },

    async createProposal(args) {
      const [proposal] = await db()
        .insert(pilotProposals)
        .values({
          action: args.action,
          checkLine: args.checkLine,
          proposedBy: args.proposedBy,
        })
        .returning();
      return proposal!;
    },

    async getProposal(proposalId) {
      const [proposal] = await db()
        .select()
        .from(pilotProposals)
        .where(eq(pilotProposals.id, proposalId))
        .limit(1);
      return proposal;
    },

    async listProposals() {
      const rows = await db()
        .select({
          proposal: pilotProposals,
          proposedByName: users.displayName,
        })
        .from(pilotProposals)
        .leftJoin(users, eq(pilotProposals.proposedBy, users.id))
        .orderBy(desc(pilotProposals.createdAt));

      // Decider names resolved separately: joining the same table twice in
      // one select needs aliased relations that the query builder makes
      // noisier than this read deserves.
      return Promise.all(
        rows.map(async ({ proposal, proposedByName }) => ({
          proposal,
          proposedByName: proposedByName ?? null,
          decidedByName:
            proposal.decidedBy === null
              ? null
              : (
                  await db()
                    .select({ displayName: users.displayName })
                    .from(users)
                    .where(eq(users.id, proposal.decidedBy))
                    .limit(1)
                )[0]?.displayName ?? null,
        })),
      );
    },

    async claimPendingProposal(proposalId) {
      const rows = await db()
        .update(pilotProposals)
        .set({ consumedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(pilotProposals.id, proposalId),
            eq(pilotProposals.status, "pending"),
            isNull(pilotProposals.consumedAt),
          ),
        )
        .returning();
      return rows[0];
    },

    async markDeclined(proposalId, decidedBy) {
      await db()
        .update(pilotProposals)
        .set({ status: "declined", decidedBy, decidedAt: new Date(), updatedAt: new Date() })
        .where(eq(pilotProposals.id, proposalId));
    },

    async markExecuted(proposalId, decidedBy, result) {
      await db()
        .update(pilotProposals)
        .set({
          status: "executed",
          decidedBy,
          decidedAt: new Date(),
          result,
          updatedAt: new Date(),
        })
        .where(eq(pilotProposals.id, proposalId));
    },

    async getProposalProposer(proposalId) {
      const [proposal] = await db()
        .select({ proposedBy: pilotProposals.proposedBy })
        .from(pilotProposals)
        .where(eq(pilotProposals.id, proposalId))
        .limit(1);
      return proposal?.proposedBy ?? undefined;
    },
  };
}

/** The demo consequential action's one execution: the pilot report summary. */
export async function executePilotReport(
  db: () => NodePgDatabase,
): Promise<Record<string, unknown>> {
  const [row] = await db().select({ total: count() }).from(pilotEnrollments);
  return {
    report: "pilot_enrollments",
    enrollmentCount: Number(row?.total ?? 0),
    generatedAt: new Date().toISOString(),
  };
}
