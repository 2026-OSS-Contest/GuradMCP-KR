#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, extractMetrics } from "./validate-policy-benchmark.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(directory, "quality-gates.json"), "utf8"));
const gates = config.policyBenchmark;

const boundary = extractMetrics({
  counts: { tp: 90, fn: 10, fp: 5, tn: 95 },
  latenciesMs: [1, 10, 20, 30, 40, 50]
});
assert.deepEqual(boundary, {
  recallPercent: 90,
  falsePositiveRatePercent: 5,
  p95LatencyMs: 50
});
assert.equal(evaluate(boundary, gates).pass, true, "threshold boundaries must pass");

const explicitPercent = extractMetrics({
  metrics: { recallPercent: 91, fprPercent: 1, p95Ms: 49 }
});
assert.equal(explicitPercent.falsePositiveRatePercent, 1, "percent fields must not be rescaled");
assert.equal(evaluate(explicitPercent, gates).pass, true);

const ratio = extractMetrics({ metrics: { recall: 0.91, fpr: 0.04, p95Ms: 49 } });
assert.equal(ratio.recallPercent, 91);
assert.equal(ratio.falsePositiveRatePercent, 4);
assert.equal(evaluate(ratio, gates).pass, true);

for (const metrics of [
  { recallPercent: 89.99, falsePositiveRatePercent: 0, p95LatencyMs: 1 },
  { recallPercent: 100, falsePositiveRatePercent: 5.01, p95LatencyMs: 1 },
  { recallPercent: 100, falsePositiveRatePercent: 0, p95LatencyMs: 50.01 },
  { recallPercent: 101, falsePositiveRatePercent: -1, p95LatencyMs: -1 },
  { recallPercent: 100, falsePositiveRatePercent: undefined, p95LatencyMs: 1 }
]) {
  assert.equal(evaluate(metrics, gates).pass, false, `invalid metrics passed: ${JSON.stringify(metrics)}`);
}

console.log("Quality-gate contract tests passed.");
