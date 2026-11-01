/*
 * Typed client for the persistent live-tutor API (artifacts/api-server).
 * Types come from the generated contract barrel (@workspace/api-zod) — no
 * hand-rolled shapes (spec 6.7).
 *
 * All calls are same-origin `/api/...`: next.config.ts rewrites that prefix to
 * the Express API (API_PROXY_TARGET, default http://127.0.0.1:3000), so the
 * httpOnly session cookie stays on the web origin and CORS never enters the
 * picture. `same-origin` credentials are the fetch default and kept explicit
 * here as a tenancy statement: every call rides the learner's own cookie.
 */
import type {
  SessionConfirmExchange,
  SessionList,
  SessionMaterial,
  SessionMaterialList,
  SessionTurnExchange,
  SessionTurnList,
  TutoringSession,
} from "@workspace/api-zod";

/** A failed API call with the API's own error envelope, when one arrived. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    ...init,
  });

  if (!response.ok) {
    let code: string | null = null;
    let message = `Request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { code?: string; message?: string };
      code = body.code ?? null;
      message = body.message ?? message;
    } catch {
      // Non-JSON error body — keep the status-based fallback message.
    }
    throw new ApiError(response.status, code, message);
  }

  // 204 (logout) and other empty bodies parse as null.
  return response.status === 204 ? (null as T) : ((await response.json()) as T);
}

/** The signed-in learner, or null when no valid session cookie is present. */
export async function getMe(): Promise<{ user: { id: string; email: string; role: string; displayName: string } } | null> {
  try {
    return await apiFetch("/api/auth/me");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function listSessions(params?: { status?: string }): Promise<SessionList> {
  const query = params?.status ? `?status=${encodeURIComponent(params.status)}` : "";
  return apiFetch<SessionList>(`/api/sessions${query}`);
}

export async function createSession(body: { title?: string }): Promise<TutoringSession> {
  return apiFetch<TutoringSession>("/api/sessions", { method: "POST", body: JSON.stringify(body) });
}

export async function getSession(sessionId: string): Promise<TutoringSession> {
  return apiFetch<TutoringSession>(`/api/sessions/${sessionId}`);
}

export async function deleteSession(sessionId: string): Promise<void> {
  return apiFetch<void>(`/api/sessions/${sessionId}`, { method: "DELETE" });
}

export async function listTurns(sessionId: string): Promise<SessionTurnList> {
  return apiFetch<SessionTurnList>(`/api/sessions/${sessionId}/turns`);
}

/** Send a learner message; returns the stored exchange plus adaptive metadata. */
export async function postTurn(sessionId: string, content: string): Promise<SessionTurnExchange> {
  return apiFetch<SessionTurnExchange>(`/api/sessions/${sessionId}/turns`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

/**
 * Confirm or decline the pending proposal. The API executes the action only
 * for an explicit accepted confirmation (Sentinel gate, spec 6.11).
 */
export async function postConfirm(sessionId: string, accepted: boolean): Promise<SessionConfirmExchange> {
  return apiFetch<SessionConfirmExchange>(`/api/sessions/${sessionId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ accepted }),
  });
}

/** Upload extracted text of a student-owned study material (text only). */
export async function uploadMaterial(
  sessionId: string,
  body: { filename: string; mimeType: string; content: string },
): Promise<SessionMaterial> {
  return apiFetch<SessionMaterial>(`/api/sessions/${sessionId}/materials`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function listMaterials(sessionId: string): Promise<SessionMaterialList> {
  return apiFetch<SessionMaterialList>(`/api/sessions/${sessionId}/materials`);
}
