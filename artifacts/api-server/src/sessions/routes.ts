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

