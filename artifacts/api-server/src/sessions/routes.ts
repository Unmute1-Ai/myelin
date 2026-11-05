// Persistent tutoring session routes (spec §6.7, §6.11) — the platform live
// tutor over Postgres-backed sessions. The Sentinel boundary does not
// regress through this file: a proposed action lands ONLY as pending state
// on the session row, and only POST /:id/confirm with accepted:true
// executes it — atomically consumed, audited, exactly once. Materials are
// the student's own text uploads; retrieval reads only their rows.

import { Router, type Request, type Response, type RequestHandler, type IRouter } from "express";
import {
  ConfirmSessionActionBody,
  ConfirmSessionActionParams,
  ConfirmSessionActionResponse,
  CreateSessionBody,
  CreateSessionMaterialBody,
  CreateSessionMaterialParams,
  CreateSessionMaterialResponse,
  CreateSessionResponse,
  DeleteSessionParams,
  GetSessionParams,
  GetSessionResponse,
  ListSessionMaterialsParams,
  ListSessionMaterialsResponse,
  ListSessionTurnsParamsSchema,
  ListSessionTurnsQueryParams,
  ListSessionTurnsResponse,
  ListSessionsQueryParams,
  ListSessionsResponse,
  PostSessionTurnBody,
  PostSessionTurnParams,
  PostSessionTurnResponse,
  type Assessment,
  type PlatformErrorCode,
} from "@workspace/api-zod";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  drizzleAssessmentStore,
  recordAssessment,
  type AssessmentStore,
} from "../assessment/record";
import { authorize } from "../auth/authorize";
import { requireAuth, type AuthedRequest } from "../auth/middleware";
import { defaultAuthDeps, type AuthDeps } from "../auth/deps";
import { parseBody, parseParams, parseQuery } from "../lib/http";
import { createAdaptiveProvider, drizzleAdaptiveContextPort } from "../tutor/adaptive/engine";
import { createProvider } from "../tutor/provider";
import { ProviderRateLimitError } from "../tutor/provider/errors";
import { DEMO_LESSON } from "../tutor/lesson/money-math";
import type { TutorProvider } from "../tutor/types";
import { listProfileEntries } from "../profiles/profile-service";
import { isTextMaterial, MATERIAL_MAX_CHARS } from "./materials";
import { drizzleSessionData, type SessionDataPort } from "./session-service";
import { runLearnerTurn, rowsToHistory } from "./turn-pipeline";
import { planConfirmedExecution } from "./confirm-execution";
import { parkProposal, resolveProposal } from "../sentinel/sentinel";

/** 4xx/5xx with the platform error shape; never logs payload values. */
function sendSessionError(res: Response, status: number, code: PlatformErrorCode, message: string): void {
  res.status(status).json({ code, message });
}

const SESSION_PAGE = 200;

export interface SessionDeps extends AuthDeps {
  data: SessionDataPort;
  provider: TutorProvider;
  assessments: AssessmentStore;
  authenticate?: RequestHandler;
}

/** Production wiring: real sessions and adaptive engine over the configured Primer provider. */
export function defaultSessionDeps(): SessionDeps {
  const auth = defaultAuthDeps();
  return {
    ...auth,
    // Ports build lazily on first use: importing the router must not
    // construct a pg pool (tests mount the app without DATABASE_URL, and
    // defaultAuthDeps already keeps its own db getter lazy for this reason).
    data: lazyPort(() => drizzleSessionData(auth.db())),
    assessments: lazyPort(() => drizzleAssessmentStore(auth.db())),
    provider: createAdaptiveProvider({
      base: createProvider(),
      port: drizzleAdaptiveContextPort(auth.db),
    }),
  };
}

/** Forward every call to a port built on first use. */
function lazyPort<T extends object>(build: () => T): T {
  let port: T | undefined;
  return new Proxy({} as T, {
    get(_target, prop: string | symbol) {
      port ??= build();
      const value = Reflect.get(port, prop) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(port) : value;
    },
  }) as T;
}

/** The load-bearing authorization resource for a session: its owning student. */
function sessionResource(session: { studentId: string }): { type: "user_data"; userId: string } {
  return { type: "user_data", userId: session.studentId };
}

function sessionNotFound(res: Response): void {
  sendSessionError(res, 404, "not_found", "This session doesn't exist (or has been deleted).");
}

/**
 * The strategyWhy surfaced with a turn: the engine writes its why-changed
 * note through the profile seam during the turn — the newest entry written
 * inside this request's window is the one this turn caused (spec §6.2, §6.4).
 */
async function strategyWhyForThisTurn(
  db: () => NodePgDatabase,
  studentId: string,
  turnStart: Date,
): Promise<string | undefined> {
  const entries = await listProfileEntries(db(), studentId, "strategy_change");
  const note = entries.find((entry) => entry.createdAt >= turnStart);
  return note?.whyChanged ?? undefined;
}

export function createSessionRoutes(deps: SessionDeps = defaultSessionDeps()): IRouter {
  const router: IRouter = Router();

  router.use(deps.authenticate ?? requireAuth(deps));

  // ---------------------------------------------------------------------------
  // POST /sessions — start a session (students only, their own).
  // ---------------------------------------------------------------------------
  router.post("/", async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;
    const body = parseBody(req, res, CreateSessionBody);
    if (body === undefined) return;

    await authorize(user, "start_session", { type: "user_data", userId: user.id }, deps);
    const session = await deps.data.createSession(user.id, body.title ?? null);
    await deps.audit.record({
      actorId: user.id,
      action: "create_session",
      resourceType: "tutoring_session",
      resourceId: session.id,
      decision: "allowed",
      authorizationEvidence: { role: user.role },
    });
    res.status(201).json(CreateSessionResponse.parse(session));
  });

  // ---------------------------------------------------------------------------
  // GET /sessions — the caller's own sessions, newest activity first.
  // ---------------------------------------------------------------------------
  router.get("/", async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;
    await authorize(user, "view_progress", { type: "user_data", userId: user.id }, deps);

    const query = parseQuery(req, res, ListSessionsQueryParams);
    if (query === undefined) return;
    const sessions = await deps.data.listSessions(user.id, query.status ?? null, query.limit);
    res.json(ListSessionsResponse.parse({ sessions }));
  });

  // ---------------------------------------------------------------------------
  // GET /sessions/:sessionId — one session (self, or a linked parent).
  // ---------------------------------------------------------------------------
  router.get("/:sessionId", async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;
    const params = parseParams(req, res, GetSessionParams);
    if (params === undefined) return;

    const session = await deps.data.getSession(params.sessionId);
    if (session === undefined) {
      sessionNotFound(res);
      return;
    }
    await authorize(user, "view_progress", sessionResource(session), deps);
    res.json(GetSessionResponse.parse(session));
  });

  // ---------------------------------------------------------------------------
  // DELETE /sessions/:sessionId — the session's own student only.
  // ---------------------------------------------------------------------------
  router.delete("/:sessionId", async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;
    const params = parseParams(req, res, DeleteSessionParams);
    if (params === undefined) return;

    const session = await deps.data.getSession(params.sessionId);
    if (session === undefined) {
      sessionNotFound(res);
      return;
    }
    // start_session is the student-only self action — exactly the delete rule
    // for a session (a parent may view; nobody else may touch).
    await authorize(user, "start_session", sessionResource(session), deps);
    await deps.data.deleteSession(params.sessionId);
    await deps.audit.record({
      actorId: user.id,
      action: "delete_session",
      resourceType: "tutoring_session",
      resourceId: params.sessionId,
      decision: "allowed",
      authorizationEvidence: { role: user.role },
    });
    res.status(204).send();
  });

  // ---------------------------------------------------------------------------
  // GET /sessions/:sessionId/turns — restored history (self or linked parent).
  // ---------------------------------------------------------------------------
  router.get("/:sessionId/turns", async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;
    const params = parseParams(req, res, ListSessionTurnsParamsSchema);
    if (params === undefined) return;

    const session = await deps.data.getSession(params.sessionId);
    if (session === undefined) {
      sessionNotFound(res);
      return;
    }
    await authorize(user, "view_progress", sessionResource(session), deps);

    const query = parseQuery(req, res, ListSessionTurnsQueryParams);
    if (query === undefined) return;
    const turns = await deps.data.listTurns(params.sessionId, query.after ?? 0, query.limit);
    res.json(ListSessionTurnsResponse.parse({ turns }));
  });

  // ---------------------------------------------------------------------------
  // POST /sessions/:sessionId/turns — one learner turn through the pipeline.
  // ---------------------------------------------------------------------------
  router.post("/:sessionId/turns", async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;
    const params = parseParams(req, res, PostSessionTurnParams);
    if (params === undefined) return;
    const body = parseBody(req, res, PostSessionTurnBody);
    if (body === undefined) return;

    const session = await deps.data.getSession(params.sessionId);
    if (session === undefined) {
      sessionNotFound(res);
      return;
    }
    await authorize(user, "start_session", sessionResource(session), deps);

    const turnStart = new Date();
    try {
      const { exchange, proposed } = await runLearnerTurn(deps.data, deps.provider, {
        studentId: session.studentId,
        sessionId: params.sessionId,
        content: body.content,
      });

      // Provider output is untrusted: a proposal parks as pending state on
      // the session row through the platform Sentinel boundary — it never
      // executes on its own (spec §6.11), and the proposal itself is audited.
      if (proposed !== null) {
        await parkProposal(
          {
            park: async (pending) => {
              // The park port is void-valued; setPending's row return is
              // meaningless here.
              await deps.data.setPending(params.sessionId, pending);
            },
          },
          proposed,
          deps.audit,
          { resourceType: "tutoring_session", resourceId: params.sessionId },
          user.id,
        );
      }

      // Recall evidence a correct check answer earns (spec §6.3 cap) — the
      // write boundary validates the pairing; a recording failure must not
      // fail the turn the learner is waiting on. Logged, never silent.
      const savedAssessments: Assessment[] = [];
      for (const assessment of exchange.recordedAssessments) {
        try {
          savedAssessments.push(await recordAssessment(deps.assessments, { ...assessment }));
        } catch (error: unknown) {
          req.log?.warn({ err: error }, "assessment recording failed — turn continues");
        }
      }

      const strategyWhy = await strategyWhyForThisTurn(deps.db, session.studentId, turnStart);
      res.status(201).json(
        PostSessionTurnResponse.parse({
          studentTurn: exchange.studentTurn,
          tutorTurn: exchange.tutorTurn,
          spokenReply: exchange.spoken,
          ...(proposed !== null ? { proposedAction: proposed.action, checkLine: proposed.checkLine } : {}),
          ...(exchange.tutorTurn.strategyId !== null ? { strategyId: exchange.tutorTurn.strategyId } : {}),
          ...(strategyWhy !== undefined ? { strategyWhy } : {}),
          recordedAssessments: savedAssessments,
        }),
      );
    } catch (error: unknown) {
      if (error instanceof ProviderRateLimitError) {
        req.log?.warn("session tutor provider rate limited");
        sendSessionError(res, 429, "rate_limited", "The tutor is catching its breath. Try again in a moment.");
        return;
      }
      req.log?.error({ err: error }, "session turn failed");
      sendSessionError(res, 502, "provider_error", "The tutor brain is unavailable right now. Try again in a moment.");
    }
  });

  // ---------------------------------------------------------------------------
  // POST /sessions/:sessionId/confirm — the Sentinel execution path.
  // ---------------------------------------------------------------------------
  router.post("/:sessionId/confirm", async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;
    const params = parseParams(req, res, ConfirmSessionActionParams);
    if (params === undefined) return;
    const body = parseBody(req, res, ConfirmSessionActionBody);
    if (body === undefined) return;

    const session = await deps.data.getSession(params.sessionId);
    if (session === undefined) {
      sessionNotFound(res);
      return;
    }
    await authorize(user, "start_session", sessionResource(session), deps);

    // The generalized Sentinel resolution: atomic consume, decline drops the
    // proposal with an audit row, accept executes exactly once with an audit
    // row. A second confirm finds nothing pending and lands in 409 below.
    const outcome = await resolveProposal({
      consumer: { consume: () => deps.data.consumePending(params.sessionId) },
      accepted: body.accepted,
      actorId: user.id,
      resource: { resourceType: "tutoring_session", resourceId: params.sessionId },
      audit: deps.audit,
      execute: async (pending) => {
        // The one execution path for a confirmed consequential action.
        const rows = await deps.data.listTurns(params.sessionId, 0, SESSION_PAGE);
        const planned = planConfirmedExecution(DEMO_LESSON, rowsToHistory(rows), pending);
        const tutorTurns = await deps.data.appendTurns(params.sessionId, {
          student: null,
          tutor: planned.turns,
        });
        return { planned, tutorTurns };
      },
    });

    if (outcome.status === "no_pending") {
      sendSessionError(res, 409, "no_pending_action", "Nothing is waiting on a confirmation right now.");
      return;
    }

    // Decline: the proposal was consumed — nothing executes, nothing stored.
    if (outcome.status === "declined") {
      res.json(
        ConfirmSessionActionResponse.parse({
          executed: false,
          tutorTurns: [],
          reply: "Okay — we'll stay right here.",
          spoken: "Okay — we'll stay right here.",
        }),
      );
      return;
    }

    res.json(
      ConfirmSessionActionResponse.parse({
        executed: true,
        tutorTurns: outcome.result.tutorTurns,
        reply: outcome.result.planned.reply,
        spoken: outcome.result.planned.spoken,
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // POST /sessions/:sessionId/materials — the student's own text uploads.
  // ---------------------------------------------------------------------------
  router.post("/:sessionId/materials", async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;
    const params = parseParams(req, res, CreateSessionMaterialParams);
    if (params === undefined) return;
    const body = parseBody(req, res, CreateSessionMaterialBody);
    if (body === undefined) return;

    const session = await deps.data.getSession(params.sessionId);
    if (session === undefined) {
      sessionNotFound(res);
      return;
    }
    await authorize(user, "start_session", sessionResource(session), deps);

    // v1 is text-only: the tutor retrieves from extracted text, so binaries
    // would be dead weight pretending to be knowledge.
    if (!isTextMaterial(body.mimeType)) {
      sendSessionError(res, 400, "invalid_request", "Only text files work right now — txt, md, or csv.");
      return;
    }
    if (body.content.length > MATERIAL_MAX_CHARS) {
      sendSessionError(res, 400, "invalid_request", "That file is too large — keep it under 100,000 characters.");
      return;
    }

    const material = await deps.data.insertMaterial({
      sessionId: params.sessionId,
      studentId: session.studentId,
      filename: body.filename,
      mimeType: body.mimeType,
      sizeBytes: Buffer.byteLength(body.content, "utf8"),
      contentText: body.content,
    });
    // Trail row carries identity and size, never the uploaded content — the
    // material's text is learner data, not audit evidence.
    await deps.audit.record({
      actorId: user.id,
      action: "upload_material",
      resourceType: "session_material",
      resourceId: material.id,
      decision: "allowed",
      authorizationEvidence: { role: user.role, sessionId: params.sessionId },
      metadata: { sizeBytes: material.sizeBytes, mimeType: material.mimeType },
    });
    res.status(201).json(CreateSessionMaterialResponse.parse({ material }));
  });

  // ---------------------------------------------------------------------------
  // GET /sessions/:sessionId/materials — metadata only; text never echoes.
  // ---------------------------------------------------------------------------
  router.get("/:sessionId/materials", async (req: Request, res: Response) => {
    const user = (req as AuthedRequest).user;
    const params = parseParams(req, res, ListSessionMaterialsParams);
    if (params === undefined) return;

    const session = await deps.data.getSession(params.sessionId);
    if (session === undefined) {
      sessionNotFound(res);
      return;
    }
    await authorize(user, "view_progress", sessionResource(session), deps);

    const materials = await deps.data.listMaterials(params.sessionId);
    res.json(ListSessionMaterialsResponse.parse({ materials }));
  });

  return router;
}
