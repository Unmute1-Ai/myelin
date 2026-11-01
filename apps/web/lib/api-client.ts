/*
 * Browser API layer for the PRIMER surfaces (spec §6.7). Every call goes
 * through the same-origin /api proxy (next.config.ts) so the httpOnly
 * session cookie rides along, and every response body is parsed by the
 * generated @workspace/api-zod validators — the contract, not a hand-rolled
 * type, decides what the UI may assume. Request bodies are parsed by the
 * generated request validators first, so an out-of-contract call fails
 * locally before it reaches the network.
 */
import {
  CreateProfileEntryBody,
  CreateProfileEntryResponse,
  DeleteProfileEntryParams,
  GetAccessibilityPrefsResponse,
  GetCurrentUserResponse,
  GetStudentProfileResponse,
  ListProgressEventsQueryParams,
  ListProgressEventsResponse,
  ListSessionsQueryParams,
  ListSessionsResponse,
  LoginUserBody,
  LoginUserResponse,
  RegisterUserBody,
  RegisterUserResponse,
  UpdateAccessibilityPrefsBody,
  UpdateAccessibilityPrefsResponse,
  UpdateLearningProfileBody,
  UpdateLearningProfileResponse,
  type PlatformError,
} from "@workspace/api-zod";

/** The API answered with a structured error body. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: PlatformError["code"];

  constructor(status: number, code: PlatformError["code"], message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** The API could not be reached at all (network, proxy down). */
export class ApiUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ApiUnavailableError";
  }
}

async function parseErrorBody(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { code?: string; message?: string };
    return new ApiError(
      response.status,
      // An unknown code still surfaces its status and message — never swallowed.
      (body.code ?? "invalid_request") as PlatformError["code"],
      body.message ?? "Something went wrong.",
    );
  } catch {
    return new ApiError(response.status, "invalid_request", "Something went wrong.");
  }
}

/** Same-origin proxy path. The empty default never guesses a foreign origin. */
function apiBase(): string {
  return "/api";
}

type PathParams = Record<string, string>;

interface RequestOptions {
  body?: unknown;
  query?: URLSearchParams;
  params?: PathParams;
}

async function request<S extends { parse(data: unknown): unknown }>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  responseSchema: S | undefined,
  options: RequestOptions = {},
): Promise<ReturnType<NonNullable<S>["parse"]>> {
  let url = `${apiBase()}${path}`;
  for (const [key, value] of Object.entries(options.params ?? {})) {
    url = url.replace(`{${key}}`, encodeURIComponent(value));
  }
  if (options.query) url += `?${options.query.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: options.body === undefined ? undefined : { "content-type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (cause) {
    throw new ApiUnavailableError("Can't reach PRIMER right now. Check your connection.", {
      cause,
    });
  }

  if (!response.ok) throw await parseErrorBody(response);
  if (response.status === 204 || responseSchema === undefined) return undefined as never;

  const json: unknown = await response.json();
  return responseSchema.parse(json) as ReturnType<NonNullable<S>["parse"]>;
}

// ── Auth (spec §6.1) ───────────────────────────────────────────────────────

export function login(body: unknown) {
  const parsed = LoginUserBody.parse(body);
  return request("POST", "/auth/login", LoginUserResponse, { body: parsed });
}

export function register(body: unknown) {
  const parsed = RegisterUserBody.parse(body);
  return request("POST", "/auth/register", RegisterUserResponse, { body: parsed });
}

export function logout() {
  return request("POST", "/auth/logout", undefined);
}

export function getCurrentUser() {
  return request("GET", "/auth/me", GetCurrentUserResponse);
}

// ── Learning profile (spec §6.2) ──────────────────────────────────────────

export function getStudentProfile(studentId: string) {
  return request("GET", "/profiles/{studentId}", GetStudentProfileResponse, {
    params: { studentId },
  });
}

export function updateLearningProfile(studentId: string, body: unknown) {
  const parsed = UpdateLearningProfileBody.parse(body);
  return request("PATCH", "/profiles/{studentId}", UpdateLearningProfileResponse, {
    params: { studentId },
    body: parsed,
  });
}

export function createProfileEntry(studentId: string, body: unknown) {
  const parsed = CreateProfileEntryBody.parse(body);
  return request("POST", "/profiles/{studentId}/entries", CreateProfileEntryResponse, {
    params: { studentId },
    body: parsed,
  });
}

export function deleteProfileEntry(studentId: string, entryId: string) {
  DeleteProfileEntryParams.parse({ entryId });
  return request("DELETE", "/profiles/{studentId}/entries/{entryId}", undefined, {
    params: { studentId, entryId },
  });
}

// ── Progress timeline (spec §6.7, §6.9) ───────────────────────────────────

export interface ProgressQueryInput {
  kind?: string;
  since?: Date;
  limit?: number;
}

export function listProgressEvents(studentId: string, query: ProgressQueryInput = {}) {
  const parsed = ListProgressEventsQueryParams.parse(query);
  const search = new URLSearchParams();
  if (parsed.kind !== undefined) search.set("kind", parsed.kind);
  if (parsed.since !== undefined) search.set("since", parsed.since.toISOString());
  if (parsed.limit !== undefined) search.set("limit", String(parsed.limit));
  return request("GET", "/progress/{studentId}", ListProgressEventsResponse, {
    params: { studentId },
    query: search,
  });
}

// ── Persistent sessions (spec §6.7) ───────────────────────────────────────

export interface SessionsQueryInput {
  status?: "active" | "completed";
  limit?: number;
}

export function listSessions(query: SessionsQueryInput = {}) {
  const parsed = ListSessionsQueryParams.parse(query);
  const search = new URLSearchParams();
  if (parsed.status !== undefined) search.set("status", parsed.status);
  if (parsed.limit !== undefined) search.set("limit", String(parsed.limit));
  return request("GET", "/sessions", ListSessionsResponse, { query: search });
}

// ── Accessibility preferences (spec §6.8) ─────────────────────────────────

export function getAccessibilityPrefs() {
  return request("GET", "/me/accessibility", GetAccessibilityPrefsResponse);
}

export function updateAccessibilityPrefs(body: unknown) {
  const parsed = UpdateAccessibilityPrefsBody.parse(body);
  return request("PATCH", "/me/accessibility", UpdateAccessibilityPrefsResponse, { body: parsed });
}
