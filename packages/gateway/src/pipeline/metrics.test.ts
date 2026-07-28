import { beforeEach, describe, expect, it } from "vitest";
import { metricsSnapshot, recordInspection, resetMetrics } from "./metrics.js";

describe("pipeline metrics", () => {
  beforeEach(resetMetrics);

  it("counts inspections per verdict", () => {
    recordInspection("allow", 1);
    recordInspection("block", 2);
    recordInspection("block", 3);
    const snapshot = metricsSnapshot();
    expect(snapshot.inspections).toBe(3);
    expect(snapshot.verdicts).toEqual({ allow: 1, block: 2 });
  });

  it("reports percentiles over the recorded durations", () => {
    for (let value = 1; value <= 100; value += 1) recordInspection("allow", value);
    const { latency } = metricsSnapshot();
    expect(latency.count).toBe(100);
    expect(latency.p50Ms).toBe(50);
    expect(latency.p95Ms).toBe(95);
    expect(latency.p99Ms).toBe(99);
    expect(latency.maxMs).toBe(100);
  });

  it("keeps the sample buffer bounded under sustained load (NFR-02)", () => {
    const snapshotWindow = metricsSnapshot().sampleWindow;
    for (let index = 0; index < snapshotWindow * 3; index += 1) recordInspection("allow", index % 7);
    const snapshot = metricsSnapshot();
    // Counters keep accumulating; retained samples stop at the window, so memory is flat.
    expect(snapshot.inspections).toBe(snapshotWindow * 3);
    expect(snapshot.latency.count).toBe(snapshotWindow);
  });

  it("reports zeroes before anything has been inspected", () => {
    const { latency, inspections } = metricsSnapshot();
    expect(inspections).toBe(0);
    expect(latency).toMatchObject({ count: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 });
  });
});
