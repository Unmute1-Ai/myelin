// Typed provider failures. Cloud providers throw these; the routes map them
// onto contract-safe HTTP responses (429/502) without leaking internals or
// learner input. The scripted provider throws nothing.

/** Base class so callers can `instanceof ProviderError` once. */
export abstract class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The request did not complete inside the configured timeout. */
export class ProviderTimeoutError extends ProviderError {
  constructor() {
    super("Tutor provider request timed out");
  }
}

/** The provider returned a non-2xx status (status kept for tests/logs, never sent to learners). */
export class ProviderHTTPError extends ProviderError {
  readonly status: number;
  constructor(status: number) {
    super(`Tutor provider request failed: HTTP ${status}`);
    this.status = status;
  }
}

/** The provider's response body was not parseable JSON. */
export class ProviderParseError extends ProviderError {
  constructor() {
    super("Tutor provider response was not valid JSON");
  }
}

/** The dev-only rate limiter for cloud providers is out of tokens. */
export class ProviderRateLimitError extends ProviderError {
  constructor() {
    super("Tutor provider rate limit exhausted");
  }
}
