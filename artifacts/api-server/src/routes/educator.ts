import { Router, type RequestHandler, type IRouter } from "express";
import {
  CreateEducatorAssignmentBody,
  CreateEducatorAssignmentResponse,
  CreateEducatorLinkBody,
  CreateEducatorLinkResponse,
  GetEducatorSupportsParams,
  GetEducatorSupportsResponse,
  GrantEducatorLinkParams,
  GrantEducatorLinkResponse,
  ListEducatorAssignmentsResponse,
  ListEducatorLinksResponse,
  ListEducatorStudentsResponse,
  RevokeEducatorLinkParams,
  RevokeEducatorLinkResponse,
  UpdateEducatorSupportsBody,
  UpdateEducatorSupportsParams,
  UpdateEducatorSupportsResponse,
} from "@workspace/api-zod";
import { authorize } from "../auth/authorize";
import { requireAuth, requireRole, type AuthedRequest } from "../auth/middleware";
import { defaultAuthDeps, type AuthDeps } from "../auth/deps";
import { parseBody, parseParams, sendError } from "../lib/http";
import { drizzleEducatorData } from "../educator/educator-data";
import type { EducatorDataPort, LinkStatus, SupportsUpdate } from "../educator/educator-service";

/**
 * Educator dashboard routes (contract: /educator/*, spec §6.10). The shape of
 * access is the linking model: an educator's rollups, assignments, and
 * supports cover only students whose link an admin has GRANTED — a pending
 * or revoked link contributes nothing. Nothing here overrides the
 * authorization layer: student-scoped routes run through `authorize()` and
 * the policy table, which no role bypasses.
 */
export interface EducatorDeps extends AuthDeps {
  data: EducatorDataPort;
  /** Test seam: substitute the session boundary (real one covered by the auth suite). */
  authenticate?: RequestHandler;
}

/** Production wiring: real sessions and the drizzle-backed educator port. */
export function defaultEducatorDeps(): EducatorDeps {
  const auth = defaultAuthDeps();
  return { ...auth, data: drizzleEducatorData(auth.db) };
}

/** One link's contract view — the student's minimal identity joins it. */
function linkView(link: {
  id: string;
  educatorId: string;
  studentId: string;
  status: LinkStatus;
  createdAt: Date;
  updatedAt: Date;
  studentEmail: string;
  studentDisplayName: string;
}) {
  return {
    id: link.id,
    educatorId: link.educatorId,
    studentId: link.studentId,
    status: link.status,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
    student: {
      id: link.studentId,
      email: link.studentEmail,
      displayName: link.studentDisplayName,
    },
  };
}

export function createEducatorRoutes(deps: EducatorDeps = defaultEducatorDeps()): IRouter {
  const router: IRouter = Router();

  router.use(deps.authenticate ?? requireAuth(deps));

  // Class rollup for the educator dashboard. Authorization is by construction:
  // only students holding a GRANTED link to the caller are queried, so a
  // pending or revoked link means an absent row, never a redacted-looking one.
  router.get("/students", requireRole(deps, "educator"), async (req, res) => {
    const user = (req as AuthedRequest).user;
    const links = await deps.data.listLinks(user.id);
    const grantedStudentIds = links
      .filter((link) => link.status === "granted")
      .map((link) => link.studentId);

    const students = await deps.data.listClassSummaries(grantedStudentIds);
    res.json(ListEducatorStudentsResponse.parse({ students }));
  });

  // Link listing: educators see their own; admins see all links so they can
  // action grant/revoke requests.
  router.get("/links", requireRole(deps, "educator", "admin"), async (req, res) => {
    const user = (req as AuthedRequest).user;
    const links = await deps.data.listLinks(user.role === "admin" ? undefined : user.id);
    res.json(ListEducatorLinksResponse.parse({ links: links.map(linkView) }));
  });

  // Request a link to a student by account email. The link starts pending and
  // grants nothing until an admin grants it (spec §6.1 — the recorded grant is
  // the human decision). Idempotent per educator-student pair.
  router.post("/links", requireRole(deps, "educator"), async (req, res) => {
    const user = (req as AuthedRequest).user;
    const body = parseBody(req, res, CreateEducatorLinkBody);
    if (body === undefined) return;

    const studentId = await deps.data.studentIdByEmail(body.studentEmail);
    if (studentId === undefined) {
      sendError(res, 404, "student_not_found", "No student account matches that email.");
      return;
    }

    const existing = await deps.data.findLinkByPair(user.id, studentId);
    if (existing) {
      res.json(CreateEducatorLinkResponse.parse(linkView(existing)));
      return;
    }

    const created = await deps.data.createLink(user.id, studentId);

    await deps.audit.record({
      actorId: user.id,
      action: "create_educator_link",
      resourceType: "educator_link",
      resourceId: created.id,
      decision: "allowed",
      authorizationEvidence: { role: user.role, studentId, status: created.status },
    });

    res.status(201).json(CreateEducatorLinkResponse.parse(linkView(created)));
  });

  // Grant — the admin's recorded human authorization decision. The policy
  // table gates the action on the admin role (defense in depth), and the
  // decision is audited by authorize() itself.
  router.post("/links/:linkId/grant", requireRole(deps, "admin"), async (req, res) => {
    const user = (req as AuthedRequest).user;
    const params = parseParams(req, res, GrantEducatorLinkParams);
    if (params === undefined) return;

    const link = await deps.educatorAccess.getEducatorLink(params.linkId);
    if (link === undefined) {
      sendError(res, 404, "link_not_found", "No educator link with that id.");
      return;
    }

    await authorize(user, "manage_educator_link", { type: "educator_link", educatorLinkId: link.id }, deps);

    if (link.status === "revoked") {
      // A revoked link stays revoked — request a new link instead.
      sendError(res, 409, "link_revoked", "This link was revoked; request a new one.");
      return;
    }

    const granted = await deps.data.setLinkStatus(link.id, "granted");
    res.json(GrantEducatorLinkResponse.parse(linkView(granted)));
  });

  // Revoke — an admin any link, an educator their own. Idempotent: revoking a
  // revoked link returns it unchanged (the contract's 200 "or already
  // revoked"). Access ends immediately on the next authorize() check.
  router.post("/links/:linkId/revoke", requireRole(deps, "educator", "admin"), async (req, res) => {
    const user = (req as AuthedRequest).user;
    const params = parseParams(req, res, RevokeEducatorLinkParams);
    if (params === undefined) return;

    const link = await deps.educatorAccess.getEducatorLink(params.linkId);
    if (link === undefined) {
      sendError(res, 404, "link_not_found", "No educator link with that id.");
      return;
    }

    await authorize(user, "manage_educator_link", { type: "educator_link", educatorLinkId: link.id }, deps);

    if (link.status === "revoked") {
      res.json(RevokeEducatorLinkResponse.parse(linkView(await deps.data.setLinkStatus(link.id, "revoked"))));
      return;
    }

    const revoked = await deps.data.setLinkStatus(link.id, "revoked");
    res.json(RevokeEducatorLinkResponse.parse(linkView(revoked)));
  });

  // The educator's own assignments, newest first.
  router.get("/assignments", requireRole(deps, "educator"), async (req, res) => {
    const user = (req as AuthedRequest).user;
    const assignments = await deps.data.listAssignments(user.id);
    res.json(ListEducatorAssignmentsResponse.parse({ assignments }));
  });

  // Assign work to a linked student. The 404/403 split keeps the survey
  // honest: an unknown id is a 404, a real student the educator holds no
  // granted link to is a deny from the policy table.
  router.post("/assignments", requireRole(deps, "educator"), async (req, res) => {
    const user = (req as AuthedRequest).user;
    const body = parseBody(req, res, CreateEducatorAssignmentBody);
    if (body === undefined) return;

    if (!(await deps.data.studentExists(body.studentId))) {
      sendError(res, 404, "student_not_found", "No student account with that id.");
      return;
    }

    await authorize(user, "assign_work", { type: "user_data", userId: body.studentId }, deps);

    const assignment = await deps.data.createAssignment({
      educatorId: user.id,
      studentId: body.studentId,
      title: body.title,
      detail: body.detail ?? null,
      subject: body.subject ?? null,
    });
    res.status(201).json(CreateEducatorAssignmentResponse.parse(assignment));
  });

  // A linked student's support plan. Unsaved plan reads as empty — never a
  // 404: the plan not existing yet is normal, not missing data.
  router.get("/students/:studentId/supports", requireRole(deps, "educator"), async (req, res) => {
    const user = (req as AuthedRequest).user;
    const params = parseParams(req, res, GetEducatorSupportsParams);
    if (params === undefined) return;

    if (!(await deps.data.studentExists(params.studentId))) {
      sendError(res, 404, "student_not_found", "No student account with that id.");
      return;
    }

    await authorize(user, "configure_supports", { type: "user_data", userId: params.studentId }, deps);

    const saved = await deps.data.getSupports(params.studentId);
    res.json(
      GetEducatorSupportsResponse.parse(
        saved ?? {
          studentId: params.studentId,
          supports: [],
          notes: null,
          updatedBy: null,
          updatedAt: null,
        },
      ),
    );
  });

  // Configure the support plan (replace). The plan is deliberately
  // non-diagnostic classroom supports; updatedBy keeps the human trail
  // behind the change, and authorize() audits the decision.
  router.put("/students/:studentId/supports", requireRole(deps, "educator"), async (req, res) => {
    const user = (req as AuthedRequest).user;
    const params = parseParams(req, res, UpdateEducatorSupportsParams);
    if (params === undefined) return;
    const body = parseBody(req, res, UpdateEducatorSupportsBody);
    if (body === undefined) return;

    if (!(await deps.data.studentExists(params.studentId))) {
      sendError(res, 404, "student_not_found", "No student account with that id.");
      return;
    }

    await authorize(user, "configure_supports", { type: "user_data", userId: params.studentId }, deps);

    const update: SupportsUpdate = { supports: body.supports, notes: body.notes ?? null };
    const saved = await deps.data.upsertSupports(params.studentId, update, user.id);
    res.json(UpdateEducatorSupportsResponse.parse(saved));
  });

  return router;
}
