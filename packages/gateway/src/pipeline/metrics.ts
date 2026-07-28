// In-process instrumentation for the inspection pipeline (GMCP-52, NFR-01/NFR-06).
//
// The benchmark measures the pipeline offline; this measures the gateway that is
// actually serving traffic, so the p95 budget can be checked on a running instance
// instead of inferred from a lab run.
//
// NFR-04: nothing here records payload text, tool arguments, or detected values —
// only verdict counts and durations. A metrics endpoint must never become a second
// way to read the data the gateway exists to protect.
import type { Action } from "@guardmcp/policy-engine";

/** Keeps memory flat under sustained load (NFR-02): oldest samples fall out. */
const maxSamples = 1024;

const verdictCounts = new Map<string, number>();
const durationsMs: number[] = [];
let nextSampleSlot = 0;
let inspections = 0;

export interface LatencySummary {
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface MetricsSnapshot {
  inspections: number;
  verdicts: Record<string, number>;
  latency: LatencySummary;
  /** Number of durations retained for the percentiles above. */
  sampleWindow: number;
}

/** Records one completed inspection: its verdict and how long the pipeline took. */
export function recordInspection(verdict: Action, durationMs: number): void {
  inspections += 1;
  verdictCounts.set(verdict, (verdictCounts.get(verdict) ?? 0) + 1);
  if (durationsMs.length < maxSamples) {
    durationsMs.push(durationMs);
    return;
  }
  durationsMs[nextSampleSlot] = durationMs;
  nextSampleSlot = (nextSampleSlot + 1) % maxSamples;
}

export function metricsSnapshot(): MetricsSnapshot {
  const sorted = [...durationsMs].sort((left, right) => left - right);
  return {
    inspections,
    verdicts: Object.fromEntries([...verdictCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
    latency: {
      count: sorted.length,
      p50Ms: percentile(sorted, 0.5),
      p95Ms: percentile(sorted, 0.95),
      p99Ms: percentile(sorted, 0.99),
      maxMs: sorted.at(-1) ?? 0
    },
    sampleWindow: maxSamples
  };
}

/** Test seam; production never resets. */
export function resetMetrics(): void {
  verdictCounts.clear();
  durationsMs.length = 0;
  nextSampleSlot = 0;
  inspections = 0;
}

/** Nearest-rank percentile over an ascending sample list. */
function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(sorted.length * fraction);
  const index = Math.min(sorted.length, Math.max(1, rank)) - 1;
  return sorted[index] ?? 0;
}
