/*
 * Honest session metrics — pure functions + a tiny recorder.
 *
 * Everything measured here is from THIS session on THIS device. Nothing is
 * persisted and nothing is uploaded; the UI presents these numbers as live
 * observations only, never as benchmark claims.
 */

export interface MetricsSnapshot {
  framesProcessed: number;
  medianLatencyMs: number | null;
  p95LatencyMs: number | null;
}

export interface AccuracyCounts {
  correct: number;
  total: number;
}

// Linear-interpolated percentile of an ascending-sorted array. Empty input
// returns null so the UI can show "no data yet" instead of a fake 0.
export function percentile(sortedValues: number[], p: number): number | null {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const rank = (p / 100) * (sortedValues.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedValues[lo];
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (rank - lo);
}

export function median(values: number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 50);
}

export function p95(values: number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 95);
}

// Observed accuracy from confirmations only. Null when nothing was judged —
// never present a placeholder rate.
export function observedAccuracy(counts: AccuracyCounts): number | null {
  if (counts.total === 0) return null;
  return counts.correct / counts.total;
}

/**
 * Rolling recorder for per-prediction latency. Keeps a bounded sample window
 * (oldest dropped) so the snapshot reflects how the pipeline is performing
 * right now, not a stale average from minutes ago.
 */
export function createMetricsRecorder(windowSize = 600) {
  let framesProcessed = 0;
  let latencies: number[] = [];

  return {
    record(latencyMs: number): void {
      framesProcessed += 1;
      latencies.push(latencyMs);
      if (latencies.length > windowSize) {
        latencies = latencies.slice(latencies.length - windowSize);
      }
    },
    snapshot(): MetricsSnapshot {
      return {
        framesProcessed,
        medianLatencyMs: median(latencies),
        p95LatencyMs: p95(latencies),
      };
    },
    reset(): void {
      framesProcessed = 0;
      latencies = [];
    },
  };
}
