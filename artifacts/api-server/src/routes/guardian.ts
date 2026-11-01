import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  assessments,
  consents,
  guardianLinks,
  progressEvents,
  users,
  type Consent,
  type GuardianLink,
} from "@workspace/db/schema";
import {
  ConsentResponse,
  CreateGuardianLinkBody,
  GuardianLinkResponse,
  GuardianLinksResponse,
  LinkIdParams,
  ProgressResponse,
  RecordConsentBody,
  StudentIdParams,
  type ConsentView,
  type GuardianLinkView,
} from "../auth/schemas";
import { authorize } from "../auth/authorize";
import { requireAuth, requireRole, type AuthedRequest } from "../auth/middleware";
import { defaultAuthDeps, type AuthDeps } from "../auth/deps";
import { parseBody, parseParams, sendError } from "../lib/http";

/**
 * Guardian consent flow (spec §6.1): a parent links to a student, records
 * consent against that link, and may revoke it. The consent trail — not the
 * link status alone — is what `authorize()` checks before a parent sees any
 * student data, so this file is where "Interpretation is not authorization"
 * becomes rows in `consents`.
 */

function linkView(link: GuardianLink, consentRows: Consent[]): GuardianLinkView {
  return {
    id: link.id,
    parentId: link.parentId,
    studentId: link.studentId,
    status: link.status,
    createdAt: link.createdAt.toISOString(),
    consents: consentRows.map((consent) => consentView(consent)),
  };
}

function consentView(consent: Consent): ConsentView {
  return {
    id: consent.id,
    type: consent.type,
    termsVersion: consent.termsVersion,
    grantedAt: consent.grantedAt.toISOString(),
    revokedAt: consent.revokedAt === null ? null : consent.revokedAt.toISOString(),
  };
}

export function createGuardianRoutes(deps: AuthDeps = defaultAuthDeps()): IRouter {
  const router: IRouter = Router();

  router.use(requireAuth(deps));

  // Link a student. Creating the link records the relationship as pending —
  // it grants nothing until a consent row exists (see authorize()).
  router.post("/links", requireRole(deps, "parent"), async (req, res) => {
    const user = (req as AuthedRequest).user;
    const body = parseBody(req, res, CreateGuardianLinkBody);
    if (body === undefined) return;

    const [student] = await deps
      .db()
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, body.studentEmail), eq(users.role, "student")))
      .limit(1);
    if (!student) {
      sendError(res, 404, "student_not_found", "No student account matches that email.");
      return;
    }

    const [existing] = await deps
      .db()
      .select()
      .from(guardianLinks)
      .where(and(eq(guardianLinks.parentId, user.id), eq(guardianLinks.studentId, student.id)))
      .limit(1);
    if (existing) {
      // Idempotent: re-linking returns the current link, never a duplicate.
      res.json(GuardianLinkResponse.parse({ link: linkView(existing, []) }));
      return;
    }

    const [link] = await deps
      .db()
      .insert(guardianLinks)
      .values({ parentId: user.id, studentId: student.id })
      .returning();

    await deps.audit.record({
      actorId: user.id,
      action: "create_guardian_link",
      resourceType: "guardian_link",
      resourceId: link.id,
      decision: "allowed",
      authorizationEvidence: { role: user.role, studentId: student.id, status: link.status },
    });

    res.status(201).json(GuardianLinkResponse.parse({ link: linkView(link, []) }));
  });

  // A parent sees only their own links — the query itself is scoped by actor.
  router.get("/links", requireRole(deps, "parent"), async (req, res) => {
    const user = (req as AuthedRequest).user;
    const links = await deps.db().select().from(guardianLinks).where(eq(guardianLinks.parentId, user.id));
    const consentRows =
      links.length === 0
        ? []
        : await deps
            .db()
            .select()
            .from(consents)
            .where(inArray(consents.guardianLinkId, links.map((link) => link.id)));

    res.json(
      GuardianLinksResponse.parse({
        links: links.map((link) =>
          linkView(link, consentRows.filter((consent) => consent.guardianLinkId === link.id)),
        ),
      }),
    );
  });

  // Record consent on a link — the moment access begins (or widens).
  router.post("/links/:linkId/consents", requireRole(deps, "parent"), async (req, res) => {
    const user = (req as AuthedRequest).user;
    const params = parseParams(req, res, LinkIdParams);
    if (params === undefined) return;
    const body = parseBody(req, res, RecordConsentBody);
    if (body === undefined) return;

    await authorize(user, "manage_guardian_link", { type: "guardian_link", guardianLinkId: params.linkId }, deps);

    const [link] = await deps.db().select().from(guardianLinks).where(eq(guardianLinks.id, params.linkId)).limit(1);
    if (!link) {
      // Owner passed the gate; the link vanished between the check and here.
      sendError(res, 404, "link_not_found", "No guardian link exists here.");
      return;
    }
    if (link.status === "revoked") {
      sendError(res, 409, "link_revoked", "This link was revoked. Create a new link to start over.");
      return;
    }

    const [consent] = await deps
      .db()
      .insert(consents)
      .values({ guardianLinkId: link.id, type: body.type, termsVersion: body.termsVersion })
      .returning();
    const [updated] = await deps
      .db()
      .update(guardianLinks)
      .set({ status: "granted", updatedAt: new Date() })
      .where(eq(guardianLinks.id, link.id))
      .returning();

    await deps.audit.record({
      actorId: user.id,
      action: "record_consent",
      resourceType: "guardian_link",
      resourceId: link.id,
      decision: "allowed",
      authorizationEvidence: { consentType: body.type, termsVersion: body.termsVersion, consentId: consent.id },
    });

    res.status(201).json(ConsentResponse.parse({ consent: consentView(consent), link: linkView(updated, [consent]) }));
  });

  // Revoke — the grant row keeps its grantedAt and gains revokedAt only.
  router.post("/links/:linkId/revoke", requireRole(deps, "parent"), async (req, res) => {
    const user = (req as AuthedRequest).user;
    const params = parseParams(req, res, LinkIdParams);
    if (params === undefined) return;

    await authorize(user, "manage_guardian_link", { type: "guardian_link", guardianLinkId: params.linkId }, deps);

    const [link] = await deps.db().select().from(guardianLinks).where(eq(guardianLinks.id, params.linkId)).limit(1);
    if (!link) {
      sendError(res, 404, "link_not_found", "No guardian link exists here.");
      return;
    }

    let current = link;
    if (current.status !== "revoked") {
      const revokedAt = new Date();
      await deps
        .db()
        .update(consents)
        .set({ revokedAt })
        .where(and(eq(consents.guardianLinkId, current.id), isNull(consents.revokedAt)));
      const [updated] = await deps
        .db()
        .update(guardianLinks)
        .set({ status: "revoked", updatedAt: revokedAt })
        .where(eq(guardianLinks.id, current.id))
        .returning();
      current = updated;

      await deps.audit.record({
        actorId: user.id,
        action: "revoke_guardian_link",
        resourceType: "guardian_link",
        resourceId: current.id,
        decision: "allowed",
        authorizationEvidence: { revokedAt: revokedAt.toISOString() },
      });
    }
    const consentRows = await deps.db().select().from(consents).where(eq(consents.guardianLinkId, current.id));

    res.json(GuardianLinkResponse.parse({ link: linkView(current, consentRows) }));
  });

  // Progress for a linked student — summaries only, consent-gated and audited.
  router.get("/students/:studentId/progress", requireRole(deps, "parent"), async (req, res) => {
    const user = (req as AuthedRequest).user;
    const params = parseParams(req, res, StudentIdParams);
    if (params === undefined) return;

    await authorize(user, "view_progress", { type: "user_data", userId: params.studentId }, deps);

    const [student] = await deps
      .db()
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, params.studentId))
      .limit(1);
    if (!student) {
      sendError(res, 404, "student_not_found", "This student no longer has an account.");
      return;
    }

    // Minimal surveillance (spec §6.9): event summaries and mastery evidence
    // only — never session transcripts.
    const events = await deps
      .db()
      .select()
      .from(progressEvents)
      .where(eq(progressEvents.studentId, student.id))
      .orderBy(desc(progressEvents.createdAt))
      .limit(50);
    const evidence = await deps
      .db()
      .select()
      .from(assessments)
      .where(eq(assessments.studentId, student.id))
      .orderBy(desc(assessments.createdAt))
      .limit(20);

    res.json(
      ProgressResponse.parse({
        student: { id: student.id, displayName: student.displayName },
        progressEvents: events.map((event) => ({
          id: event.id,
          kind: event.kind,
          summary: event.summary,
          createdAt: event.createdAt.toISOString(),
        })),
        assessments: evidence.map((row) => ({
          id: row.id,
          subject: row.subject,
          skill: row.skill,
          level: row.level,
          evidenceKind: row.evidenceKind,
          evidenceNote: row.evidenceNote,
          createdAt: row.createdAt.toISOString(),
        })),
      }),
    );
  });

  return router;
}
