import { GetAccessibilityPrefsResponse, UpdateAccessibilityPrefsBody } from "@workspace/api-zod";
import { getApiBaseUrl, isApiConfigured } from "@/lib/api-config";
import type { AccessibilityPrefs, PreferenceFields } from "./prefs";

/*
 * Thin browser client for /me/accessibility (spec §6.8). Session cookies ride
 * automatically in the browser (credentials: "include"), so no token getter
 * exists here. Every response is validated against the contract schema — a
 * shape drift fails loudly instead of silently rendering wrong settings.
 */

/** Thrown on 401 so callers can distinguish "not signed in" from a real fault. */
export class PrefsSignedOutError extends Error {
  constructor() {
    super("Sign in to load your accessibility settings.");
    this.name = "PrefsSignedOutError";
  }
}

export class PrefsRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PrefsRequestError";
    this.status = status;
  }
}

async function prefsFetch(path: string, init?: RequestInit): Promise<unknown> {
  if (!isApiConfigured()) {
    throw new PrefsRequestError(0, "The API origin is not configured.");
  }
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (res.status === 401) throw new PrefsSignedOutError();
  if (!res.ok) {
    throw new PrefsRequestError(res.status, "The accessibility service could not be reached.");
  }
  return res.json();
}

/** Loads the caller's settings; 401 maps to PrefsSignedOutError. */
export async function fetchAccessibilityPrefs(): Promise<AccessibilityPrefs> {
  const json = await prefsFetch("/me/accessibility");
  return GetAccessibilityPrefsResponse.parse(json);
}

/** Saves a partial patch and returns the stored row. */
export async function saveAccessibilityPrefs(
  patch: Partial<PreferenceFields>,
): Promise<AccessibilityPrefs> {
  // Client-side mirror of the contract's request schema — the server
  // re-validates authoritatively.
  const body = UpdateAccessibilityPrefsBody.parse(patch);
  const json = await prefsFetch("/me/accessibility", {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return GetAccessibilityPrefsResponse.parse(json);
}
