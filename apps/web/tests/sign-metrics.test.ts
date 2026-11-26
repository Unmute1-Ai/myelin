import { describe, expect, it } from "vitest";
import {
  createMetricsRecorder,
  median,
  observedAccuracy,
  p95,
} from "@/lib/sign/metrics";

describe("median", () => {
  it("returns null for empty input", () => {
    expect(median([])).toBeNull();
  });

  it("is order-independent and interpolates evenly", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("p95", () => {
  it("returns null for empty input", () => {
    expect(p95([])).toBeNull();
  });

  it("interpolates the 95th percentile", () => {
    // 100 samples 1..100: rank = 0.95*99 = 94.05 → between 95 and 96.
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(p95(values)).toBeCloseTo(95.05, 5);
  });
});

describe("observedAccuracy", () => {
  it("is null until something is judged", () => {
    expect(observedAccuracy({ correct: 0, total: 0 })).toBeNull();
  });

  it("computes the observed rate from confirmations", () => {
    expect(observedAccuracy({ correct: 7, total: 10 })).toBe(0.7);
  });
});

describe("createMetricsRecorder", () => {
  it("tracks frames and returns live snapshot values", () => {
    const recorder = createMetricsRecorder();
    expect(recorder.snapshot()).toEqual({
      framesProcessed: 0,
      medianLatencyMs: null,
      p95LatencyMs: null,
    });
    for (const ms of [10, 20, 30, 40, 50]) recorder.record(ms);
    const snapshot = recorder.snapshot();
    expect(snapshot.framesProcessed).toBe(5);
    expect(snapshot.medianLatencyMs).toBe(30);
  });

  it("keeps only the newest window of samples", () => {
    const recorder = createMetricsRecorder(3);
    for (const ms of [100, 200, 300, 400]) recorder.record(ms);
    const snapshot = recorder.snapshot();
    expect(snapshot.framesProcessed).toBe(4);
    // Window now holds 200, 300, 400.
    expect(snapshot.medianLatencyMs).toBe(300);
  });

  it("resets to a clean state", () => {
    const recorder = createMetricsRecorder();
    recorder.record(12);
    recorder.reset();
    expect(recorder.snapshot().framesProcessed).toBe(0);
    expect(recorder.snapshot().medianLatencyMs).toBeNull();
  });
});
