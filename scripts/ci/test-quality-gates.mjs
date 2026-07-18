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
  latenciesMs: [1, 10, 20, 30, 40, 50],
  metrics: {
    payloadBytes: 10240,
    blockRate: 0.8,
    scenarioPassRate: 1,
    fixturePassRate: 1,
    fixtureCoverageRate: 1,
    authorFixtures: 12,
    policyCount: 6
  }
});
assert.deepEqual(boundary, {
  recallPercent: 90,
  falsePositiveRatePercent: 5,
  p95LatencyMs: 50,
  payloadBytes: 10240,
  blockRatePercent: 80,
  scenarioPassRatePercent: 100,
  fixturePassRatePercent: 100,
  fixtureCoverageRatePercent: 100,
  authorFixtures: 12,
  policyCount: 6
});
assert.equal(evaluate(boundary, gates).pass, true, "threshold boundaries must pass");

const explicitPercent = extractMetrics({
  metrics: {
    recallPercent: 91, fprPercent: 1, p95Ms: 49, payloadBytes: 10240,
    blockRate: 0.9, scenarioPassRate: 1, fixturePassRate: 1, fixtureCoverageRate: 1,
    authorFixtures: 12, policyCount: 6
  }
});
assert.equal(explicitPercent.falsePositiveRatePercent, 1, "percent fields must not be rescaled");
assert.equal(evaluate(explicitPercent, gates).pass, true);

const ratio = extractMetrics({ metrics: {
  recall: 0.91, fpr: 0.04, p95Ms: 49, payloadBytes: 10240,
  blockRate: 0.9, scenarioPassRate: 1, fixturePassRate: 1, fixtureCoverageRate: 1,
  authorFixtures: 12, policyCount: 6
} });
assert.equal(ratio.recallPercent, 91);
assert.equal(ratio.falsePositiveRatePercent, 4);
assert.equal(evaluate(ratio, gates).pass, true);

for (const metrics of [
  { ...boundary, recallPercent: 89.99 },
  { ...boundary, falsePositiveRatePercent: 5.01 },
  { ...boundary, p95LatencyMs: 50.01 },
  { ...boundary, payloadBytes: 1024 },
  { ...boundary, payloadBytes: undefined },
  { ...boundary, blockRatePercent: 79.99 },
  { ...boundary, scenarioPassRatePercent: 99.99 },
  { ...boundary, fixturePassRatePercent: 99.99 },
  { ...boundary, fixtureCoverageRatePercent: 99.99 },
  { ...boundary, authorFixtures: 11 },
  { ...boundary, policyCount: 0 },
  { ...boundary, recallPercent: 101, falsePositiveRatePercent: -1, p95LatencyMs: -1 },
  { ...boundary, falsePositiveRatePercent: undefined }
]) {
  assert.equal(evaluate(metrics, gates).pass, false, `invalid metrics passed: ${JSON.stringify(metrics)}`);
}

console.log("Quality-gate contract tests passed.");
