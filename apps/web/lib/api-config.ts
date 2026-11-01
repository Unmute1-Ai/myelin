/*
 * Browser-facing origin of the Express API (artifacts/api-server).
 * Configure with NEXT_PUBLIC_API_BASE_URL in .env.local (see .env.example).
 *
 * The empty-string default is deliberate: the auth wave makes the first real
 * API calls, and an implicit localhost fallback would silently fetch from the
 * wrong origin in preview deploys. Callers check isApiConfigured() and surface
 * "not configured" instead of guessing.
 */
export function getApiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
  return raw.trim().replace(/\/+$/, "");
}

export function isApiConfigured(): boolean {
  return getApiBaseUrl().length > 0;
}
