// Unit tests for the dev-only token-bucket rate limiter — clock injected so
// refill behavior is deterministic, no sleeps.

import { describe, expect, it } from "vitest";
import { ProviderRateLimitError } from "./errors";
import { RateLimiter } from "./rate-limit";

/** Manual clock: advance(ms) moves virtual time forward. */
function fakeClock() {
  let now = 0;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("RateLimiter", () => {
  it("allows a full burst up to capacity, then throws ProviderRateLimitError", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ requestsPerMinute: 3, now: clock.now });
    expect(() => {
      limiter.acquire();
      limiter.acquire();
      limiter.acquire();
    }).not.toThrow();
    expect(() => limiter.acquire()).toThrow(ProviderRateLimitError);
  });

  it("refills proportionally with elapsed time (token semantics, not fixed windows)", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ requestsPerMinute: 2, now: clock.now }); // capacity 2, 1 token per 30s
    limiter.acquire();
    limiter.acquire(); // empty
    expect(() => limiter.acquire()).toThrow(ProviderRateLimitError);
    clock.advance(15_000);
    expect(() => limiter.acquire()).toThrow(ProviderRateLimitError); // half a token — not enough
    clock.advance(15_000);
    expect(limiter.tryAcquire()).toBe(true); // a full token
  });

  it("tryAcquire reports refusal without throwing", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ requestsPerMinute: 1, now: clock.now });
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  it("caps accumulated tokens at capacity after idle periods", () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ requestsPerMinute: 2, now: clock.now });
    clock.advance(60_000 * 10); // ten minutes idle
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false); // never more than 2
  });
});
