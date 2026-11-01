// Token-bucket rate limiter for the dev-only cloud providers. Protects a
// developer's key from runaway loops (the scripted provider is local and is
// never limited). Pure clock injection keeps it deterministic under test.

import { ProviderRateLimitError } from "./errors";

export interface RateLimiterOptions {
  /** Steady-state allowance, in requests per 60 seconds. */
  requestsPerMinute: number;
  /** Injectable clock (ms epoch); defaults to Date.now. */
  now?: () => number;
}

export class RateLimiter {
  private readonly capacity: number;
  private readonly ratePerMs: number;
  private readonly now: () => number;
  private tokens: number;
  private lastRefill: number;

  constructor(options: RateLimiterOptions) {
    if (!Number.isInteger(options.requestsPerMinute) || options.requestsPerMinute <= 0) {
      throw new Error("requestsPerMinute must be a positive integer");
    }
    this.capacity = options.requestsPerMinute;
    this.ratePerMs = options.requestsPerMinute / 60_000;
    this.now = options.now ?? Date.now;
    this.tokens = this.capacity;
    this.lastRefill = this.now();
  }

  /** Refill elapsed tokens and take one if available. */
  tryAcquire(): boolean {
    const at = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + (at - this.lastRefill) * this.ratePerMs);
    this.lastRefill = at;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Take one token or throw ProviderRateLimitError — the provider call sites' contract. */
  acquire(): void {
    if (!this.tryAcquire()) throw new ProviderRateLimitError();
  }
}

export const DEFAULT_MAX_RPM = 30;

/** Limiter for a cloud provider, sized by TUTOR_PROVIDER_MAX_RPM (default 30/min). */
export function cloudRateLimiter(now: () => number = Date.now): RateLimiter {
  const raw = process.env["TUTOR_PROVIDER_MAX_RPM"];
  const parsed = raw === undefined ? NaN : Number(raw);
  const rpm = Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RPM;
  return new RateLimiter({ requestsPerMinute: rpm, now });
}
