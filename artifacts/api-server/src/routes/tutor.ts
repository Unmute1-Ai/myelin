// Tutor routes — the Primer MVP API (contract-first). Request/response shapes
// validate through the generated @workspace/api-zod schemas (health-route
// pattern); errors are typed by the generated TutorError interface.
//
// The Sentinel boundary is the platform-wide module (sentinel/sentinel.ts):
// provider proposals park here as pending confirmations; only POST /confirm
// with accepted:true executes, exactly once. This route is the unauthenticated
// demo sandbox — the MVP's locked privacy decision keeps every byte of its
// state in memory (nothing persists, no account exists), so there is no actor
// to attribute and no persistent consequence to audit: the audit port is an
// explicit no-op. The persistent platform paths (sessions routes) run the
// same boundary with a real audit trail.

import { Router, type Request, type Response, type IRouter } from "express";
import {
  ConfirmTutorActionBody,
  ConfirmTutorActionResponse,
  CreateTutorSessionResponse,
  DeleteTutorSessionParams,
  SendTutorTurnBody,
  SendTutorTurnResponse,
  type TutorError,
  type TutorErrorCode,
} from "@workspace/api-zod";
import { DEMO_LESSON } from "../tutor/lesson/money-math";
import { executeConfirmedAction } from "../tutor/confirm";
import { lessonProgress } from "../tutor/progress";
import { buildSessionContext } from "../tutor/session-context";
import { createProvider } from "../tutor/provider";
import { ProviderRateLimitError } from "../tutor/provider/errors";
import type { TurnMessage, TutorProvider } from "../tutor/types";
import { parkProposal, resolveProposal, type PendingProposal } from "../sentinel/sentinel";
import type { AuditPort } from "../auth/audit";
import { SessionNotFoundError, SessionStore, type TutorSession } from "../tutor/session-store";

/**
 * Demo-only audit port: the in-memory MVP sandbox keeps no account, no
 * persistent resource, and no trail (the MVP's locked privacy decision), so
 * there is deliberately nothing to record. Platform paths always bind a real
 * AuditPort — this port must never be their default.
 */
const DEMO_NO_AUDIT: AuditPort = { record: () => Promise.resolve() };

type Schema<T> = {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: { issues: { path: (string | number | symbol)[] }[] } };
};

/** 4xx/5xx with the contract error shape; never logs payload values. */
function sendError(res: Response, status: number, code: TutorErrorCode, message: string): void {
  const body: TutorError = { code, message };
  res.status(status).json(body);
}

/** Validate a request body; responds 400 and returns undefined when invalid. */
function parseBody<T>(req: Request, res: Response, schema: Schema<T>): T | undefined {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    // Zod issue paths only — values can carry learner input.
    req.log?.warn({ fields: result.error.issues.map((i) => i.path.join(".")) }, "tutor request failed validation");
    sendError(res, 400, "invalid_request", "The request body didn't match the expected shape.");
    return undefined;
  }
  return result.data;
}

/** Fetch the session or respond 404; undefined means the response was sent. */
function getSession(store: SessionStore, sessionId: string, res: Response): TutorSession | undefined {
  try {
    return store.get(sessionId);
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      sendError(res, 404, "session_not_found", "This session has ended. Start a new one to keep going.");
      return undefined;
    }
    throw error;
  }
}

export function createTutorRoutes(
  store: SessionStore = new SessionStore(),
  provider: TutorProvider = createProvider(),
  audit: AuditPort = DEMO_NO_AUDIT,
): IRouter {
  // Fails loud at boot on an unknown TUTOR_PROVIDER — never silently downgrade.
  const lesson = DEMO_LESSON;

  const router: IRouter = Router();

  router.post("/session", (_req, res) => {
    const session = store.create();
    res.status(201).json(CreateTutorSessionResponse.parse({ sessionId: session.id }));
  });

  router.post("/turn", (req, res) => {
    const body = parseBody(req, res, SendTutorTurnBody);
    if (body === undefined) return;
    const session = getSession(store, body.sessionId, res);
    if (session === undefined) return;

    // One provider pass per learner turn. Context (history, lesson, input,
    // derived position) is built through the shared session-context module so
    // every provider sees identical state. Provider output is untrusted: a
    // proposal only parks through the Sentinel boundary — never executed.
    let reply: TurnMessage | null = null;
    let spoken = "";
    let pending: PendingProposal | null = null;

    const run = async () => {
      const ctx = buildSessionContext(session.history, lesson, body.input, session.id);
      for await (const event of provider.turn(ctx)) {
        if (event.type === "text") {
          reply = { role: "tutor", content: event.delta, stepId: event.stepId, kind: event.kind, strategyId: event.strategyId };
        } else if (event.type === "done") {
          spoken = event.spoken;
        } else {
          pending = { action: event.action, checkLine: event.checkLine };
        }
      }
    };

    run()
      .then(async () => {
        const executedReply = reply;
        if (executedReply === null) {
          sendError(res, 502, "provider_error", "The tutor brain is unavailable right now. Try again in a moment.");
          return;
        }
        // Route recording: the tutor text message carries the position markers
        // verbatim; a proposal parks on the session — it never executes on its own.
        store.pushTurn(session, body.input, {
          role: "tutor",
          content: executedReply.content,
          stepId: executedReply.stepId,
          kind: executedReply.kind,
          strategyId: executedReply.strategyId,
        });
        if (pending !== null) {
          await parkProposal(
            { park: (p) => store.setPendingAction(session, p) },
            pending,
            audit,
            { resourceType: "tutoring_session", resourceId: session.id },
            null, // demo path: unauthenticated sandbox, no actor identity
          );
        }

        res.json(
          SendTutorTurnResponse.parse({
            reply: executedReply.content,
            spoken,
            progress: lessonProgress(session, lesson),
            ...(pending !== null ? { proposedAction: pending.action, checkLine: pending.checkLine } : {}),
          }),
        );
      })
      .catch((error: unknown) => {
        // Typed provider failures map onto contract-safe statuses; the rate
        // limit gets its own 429 so a dev loop can back off. Error objects
        // only — provider failures must never carry learner input.
        if (error instanceof ProviderRateLimitError) {
          req.log?.warn("tutor provider rate limited");
          sendError(res, 429, "provider_error", "The tutor is catching its breath. Try again in a moment.");
          return;
        }
        req.log?.error({ err: error }, "tutor provider failed");
        sendError(res, 502, "provider_error", "The tutor brain is unavailable right now. Try again in a moment.");
      });
  });

  router.post("/confirm", async (req, res) => {
    const body = parseBody(req, res, ConfirmTutorActionBody);
    if (body === undefined) return;
    const session = getSession(store, body.sessionId, res);
    if (session === undefined) return;

    // The shared Sentinel resolution: take-and-clear is atomic in-memory;
    // decline consumes with nothing executed, accept executes exactly once.
    const outcome = await resolveProposal({
      consumer: { consume: () => store.takePending(session) },
      accepted: body.accepted,
      actorId: null, // demo path: unauthenticated sandbox, no actor identity
      resource: { resourceType: "tutoring_session", resourceId: session.id },
      audit,
      execute: (executed) =>
        Promise.resolve(executeConfirmedAction(store, session, lesson, executed)),
    });

    if (outcome.status === "no_pending") {
      sendError(res, 409, "no_pending_action", "Nothing is waiting on a confirmation right now.");
      return;
    }

    if (outcome.status === "declined") {
      res.json(
        ConfirmTutorActionResponse.parse({
          reply: "Okay — we'll stay right here.",
          spoken: "Okay — we'll stay right here.",
          progress: lessonProgress(session, lesson),
          executed: false,
        }),
      );
      return;
    }

    const reply = outcome.result;
    res.json(
      ConfirmTutorActionResponse.parse({
        reply: reply.content,
        spoken: reply.spoken,
        progress: lessonProgress(session, lesson),
        executed: true,
      }),
    );
  });

  router.delete("/session/:id", (req, res) => {
    const params = DeleteTutorSessionParams.safeParse(req.params);
    if (!params.success) {
      sendError(res, 400, "invalid_request", "A session id is required.");
      return;
    }
    const session = getSession(store, params.data.id, res);
    if (session === undefined) return;

    store.delete(params.data.id);
    res.status(204).send();
  });

  return router;
}
