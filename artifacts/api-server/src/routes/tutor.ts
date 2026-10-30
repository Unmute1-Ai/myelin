// Tutor routes — the Primer MVP API (contract-first). Request/response shapes
// validate through the generated @workspace/api-zod schemas (health-route
// pattern); errors are typed by the generated TutorError interface.
//
// The Sentinel boundary lives here and must not regress: provider proposals
// become pending confirmations in session state; only POST /confirm with
// accepted:true executes, exactly once. No shell, files, payments, or
// settings surface exists anywhere in this file.

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
import { gradingStep, lessonProgress, nextUndeliveredStep } from "../tutor/progress";
import { createProvider } from "../tutor/provider";
import { MASTERED_MARKER, type PendingAction, type TurnMessage } from "../tutor/types";
import { SessionNotFoundError, SessionStore, type TutorSession } from "../tutor/session-store";

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

/** Compose the confirmation outcome. Pending is already cleared by the store. */
function executePending(store: SessionStore, session: TutorSession, lesson: typeof DEMO_LESSON, pending: PendingAction): { content: string; spoken: string } {
  if (pending.action === "advance_step") {
    const current = gradingStep(session, lesson);
    if (current !== undefined) store.markAdvanced(session, current.id);

    const next = nextUndeliveredStep(session, lesson);
    if (next !== undefined) {
      store.markTaught(session, next.id);
      return {
        content: `On we go.\n\n${next.teaching}\n\n${next.check.question}`,
        spoken: `On we go. ${next.spoken}`,
      };
    }
    return {
      content: "That was the last step — say the word if you'd like me to mark the lesson mastered.",
      spoken: "That was the last step. Nice work.",
    };
  }

  if (pending.action === "mark_mastered") {
    store.markAdvanced(session, MASTERED_MARKER);
    return {
      content: "Marked mastered. Nothing is saved once this session ends — close the tab whenever you like.",
      spoken: "Marked mastered. Nice work today.",
    };
  }

  // assign_practice has no MVP surface — acknowledging is the honest response.
  return {
    content: "Practice comes with a later version — nothing to assign just yet.",
    spoken: "Practice comes with a later version.",
  };
}

export function createTutorRoutes(store: SessionStore = new SessionStore()): IRouter {
  // Fails loud at boot on an unknown TUTOR_PROVIDER — never silently downgrade.
  const provider = createProvider();
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

    // One provider pass per learner turn. Provider output is untrusted: a
    // proposal only lands as pending state here — never executed.
    let reply: TurnMessage | null = null;
    let spoken = "";
    let pending: PendingAction | null = null;

    const run = async () => {
      for await (const event of provider.turn(session.history, lesson, body.input)) {
        if (event.type === "text") {
          reply = { role: "tutor", content: event.delta, stepId: event.stepId, kind: event.kind };
        } else if (event.type === "done") {
          spoken = event.spoken;
        } else {
          pending = { action: event.action, checkLine: event.checkLine };
        }
      }
    };

    run()
      .then(() => {
        const executedReply = reply;
        if (executedReply === null) {
          sendError(res, 502, "provider_error", "The tutor brain is unavailable right now. Try again in a moment.");
          return;
        }
        store.pushTurn(session, body.input, executedReply);
        if (pending !== null) store.setPendingAction(session, pending);

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
        // Error object only — provider failures must never carry learner input.
        req.log?.error({ err: error }, "tutor provider failed");
        sendError(res, 502, "provider_error", "The tutor brain is unavailable right now. Try again in a moment.");
      });
  });

  router.post("/confirm", (req, res) => {
    const body = parseBody(req, res, ConfirmTutorActionBody);
    if (body === undefined) return;
    const session = getSession(store, body.sessionId, res);
    if (session === undefined) return;

    // Decline: drop the pending proposal, nothing executes.
    if (!body.accepted) {
      store.clearPendingAction(session);
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

    // The only execution path for a consequential action — exactly once.
    const executed = store.consumeConfirmed(session, body.accepted);
    if (executed === null) {
      sendError(res, 409, "no_pending_action", "Nothing is waiting on a confirmation right now.");
      return;
    }

    const reply = executePending(store, session, lesson, executed);
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
