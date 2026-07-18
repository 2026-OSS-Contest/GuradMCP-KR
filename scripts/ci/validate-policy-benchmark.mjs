#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseArguments(argv) {
  const options = {
    report: path.join(ROOT, "artifacts/benchmark/metrics.json"),
    config: path.join(ROOT, "scripts/ci/quality-gates.json"),
    summary: path.join(ROOT, "artifacts/benchmark/summary.md")
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--report" || argument === "--config" || argument === "--summary") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      options[argument.slice(2)] = path.resolve(ROOT, value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function numberAt(object, candidates) {
  for (const candidate of candidates) {
    const value = candidate.split(".").reduce((current, key) => current?.[key], object);
    const numeric = typeof value === "string" ? Number(value.replace(/%$/, "")) : value;
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function asPercent(value) {
  if (!Number.isFinite(value)) return undefined;
  return value >= 0 && value <= 1 ? value * 100 : value;
}

function percentile(values, percentileValue) {
  if (!Array.isArray(values) || values.length === 0) return undefined;
  const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return undefined;
  return sorted[Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)];
}

function extractMetrics(report) {
  const counts = report.counts ?? report.metrics?.counts ?? report.confusionMatrix ?? {};
  const truePositive = numberAt(counts, ["truePositive", "truePositives", "tp"]);
  const falseNegative = numberAt(counts, ["falseNegative", "falseNegatives", "fn"]);
  const falsePositive = numberAt(counts, ["falsePositive", "falsePositives", "fp"]);
  const trueNegative = numberAt(counts, ["trueNegative", "trueNegatives", "tn"]);

  const computedRecall = Number.isFinite(truePositive) && Number.isFinite(falseNegative)
    ? truePositive / (truePositive + falseNegative)
    : undefined;
  const computedFpr = Number.isFinite(falsePositive) && Number.isFinite(trueNegative)
    ? falsePositive / (falsePositive + trueNegative)
    : undefined;

  const recallPercent = numberAt(report, [
    "metrics.recallPercent", "summary.recallPercent", "recallPercent"
  ]);
  const recall = numberAt(report, ["metrics.recall", "summary.recall", "recall"]) ?? computedRecall;
  const falsePositiveRatePercent = numberAt(report, [
    "metrics.falsePositiveRatePercent", "metrics.fprPercent", "summary.falsePositiveRatePercent",
    "falsePositiveRatePercent", "fprPercent"
  ]);
  const falsePositiveRate = numberAt(report, [
    "metrics.falsePositiveRate", "metrics.fpr", "summary.falsePositiveRate", "summary.fpr",
    "falsePositiveRate", "fpr"
  ]) ?? computedFpr;
  const p95LatencyMs = numberAt(report, [
    "metrics.p95LatencyMs", "metrics.latencyP95Ms", "metrics.p95Ms", "metrics.latency.p95Ms", "metrics.latency.p95",
    "summary.p95LatencyMs", "summary.latencyP95Ms", "latency.p95Ms", "latency.p95", "p95LatencyMs",
    "latencyP95Ms", "p95Ms", "p95"
  ]) ?? percentile(report.latenciesMs ?? report.metrics?.latenciesMs ?? report.latencySamplesMs, 0.95);
  const payloadBytes = numberAt(report, ["metrics.payloadBytes", "summary.payloadBytes", "payloadBytes"]);
  const blockRate = numberAt(report, ["metrics.blockRate", "summary.blockRate", "blockRate"]);
  const scenarioPassRate = numberAt(report, ["metrics.scenarioPassRate", "summary.scenarioPassRate", "scenarioPassRate"]);
  const fixturePassRate = numberAt(report, ["metrics.fixturePassRate", "summary.fixturePassRate", "fixturePassRate"]);
  const fixtureCoverageRate = numberAt(report, ["metrics.fixtureCoverageRate", "summary.fixtureCoverageRate", "fixtureCoverageRate"]);
  const authorFixtures = numberAt(report, ["metrics.authorFixtures", "summary.authorFixtures", "authorFixtures"]);
  const policyCount = numberAt(report, ["metrics.policyCount", "summary.policyCount", "policyCount"]);

  return {
    recallPercent: recallPercent ?? asPercent(recall),
    falsePositiveRatePercent: falsePositiveRatePercent ?? asPercent(falsePositiveRate),
    p95LatencyMs,
    payloadBytes,
    blockRatePercent: asPercent(blockRate),
    scenarioPassRatePercent: asPercent(scenarioPassRate),
    fixturePassRatePercent: asPercent(fixturePassRate),
    fixtureCoverageRatePercent: asPercent(fixtureCoverageRate),
    authorFixtures,
    policyCount
  };
}

function format(value, unit) {
  return Number.isFinite(value) ? `${value.toFixed(2)}${unit}` : "missing";
}

function evaluate(metrics, gates) {
  const checks = [
    {
      metric: "Recall",
      actual: metrics.recallPercent,
      expected: `>= ${gates.recallPercent.minimum}%`,
      pass: Number.isFinite(metrics.recallPercent)
        && metrics.recallPercent >= gates.recallPercent.minimum
        && metrics.recallPercent <= 100,
      display: format(metrics.recallPercent, "%")
    },
    {
      metric: "False-positive rate",
      actual: metrics.falsePositiveRatePercent,
      expected: `<= ${gates.falsePositiveRatePercent.maximum}%`,
      pass: Number.isFinite(metrics.falsePositiveRatePercent)
        && metrics.falsePositiveRatePercent >= 0
        && metrics.falsePositiveRatePercent <= gates.falsePositiveRatePercent.maximum,
      display: format(metrics.falsePositiveRatePercent, "%")
    },
    {
      metric: `p95 latency (${gates.p95LatencyMs.payloadBytes} byte payload)`,
      actual: metrics.p95LatencyMs,
      expected: `<= ${gates.p95LatencyMs.maximum}ms`,
      pass: Number.isFinite(metrics.p95LatencyMs)
        && metrics.p95LatencyMs >= 0
        && metrics.p95LatencyMs <= gates.p95LatencyMs.maximum
        && metrics.payloadBytes === gates.p95LatencyMs.payloadBytes,
      display: format(metrics.p95LatencyMs, "ms")
    },
    {
      metric: "Payload size",
      actual: metrics.payloadBytes,
      expected: `= ${gates.p95LatencyMs.payloadBytes} bytes`,
      pass: metrics.payloadBytes === gates.p95LatencyMs.payloadBytes,
      display: Number.isFinite(metrics.payloadBytes) ? `${metrics.payloadBytes} bytes` : "missing"
    },
    {
      metric: "Expected-threat block rate",
      actual: metrics.blockRatePercent,
      expected: `>= ${gates.blockRatePercent.minimum}%`,
      pass: Number.isFinite(metrics.blockRatePercent)
        && metrics.blockRatePercent >= gates.blockRatePercent.minimum
        && metrics.blockRatePercent <= 100,
      display: format(metrics.blockRatePercent, "%")
    },
    {
      metric: "Scenario expectation pass rate",
      actual: metrics.scenarioPassRatePercent,
      expected: `>= ${gates.scenarioPassRatePercent.minimum}%`,
      pass: Number.isFinite(metrics.scenarioPassRatePercent)
        && metrics.scenarioPassRatePercent >= gates.scenarioPassRatePercent.minimum
        && metrics.scenarioPassRatePercent <= 100,
      display: format(metrics.scenarioPassRatePercent, "%")
    },
    {
      metric: "Policy fixture pass rate",
      actual: metrics.fixturePassRatePercent,
      expected: `>= ${gates.fixturePassRatePercent.minimum}%`,
      pass: Number.isFinite(metrics.fixturePassRatePercent)
        && metrics.fixturePassRatePercent >= gates.fixturePassRatePercent.minimum
        && metrics.fixturePassRatePercent <= 100,
      display: format(metrics.fixturePassRatePercent, "%")
    },
    {
      metric: "Policy fixture coverage",
      actual: metrics.fixtureCoverageRatePercent,
      expected: `>= ${gates.fixtureCoverageRatePercent.minimum}% and >= 2 fixtures/policy`,
      pass: Number.isFinite(metrics.fixtureCoverageRatePercent)
        && metrics.fixtureCoverageRatePercent >= gates.fixtureCoverageRatePercent.minimum
        && metrics.fixtureCoverageRatePercent <= 100
        && Number.isInteger(metrics.authorFixtures)
        && Number.isInteger(metrics.policyCount)
        && metrics.policyCount > 0
        && metrics.authorFixtures >= metrics.policyCount * 2,
      display: `${format(metrics.fixtureCoverageRatePercent, "%")} (${metrics.authorFixtures ?? "missing"}/${metrics.policyCount ?? "missing"} policies)`
    }
  ];

  return { checks, pass: checks.every((check) => check.pass) };
}

function renderSummary(result, reportPath) {
  const lines = [
    "# Policy benchmark quality gate",
    "",
    `Overall: **${result.pass ? "PASS" : "FAIL"}**`,
    "",
    "| Metric | Actual | Required | Result |",
    "| --- | ---: | ---: | :---: |",
    ...result.checks.map((check) =>
      `| ${check.metric} | ${check.display} | ${check.expected} | ${check.pass ? "PASS" : "FAIL"} |`
    ),
    "",
    `Source report: \`${path.relative(ROOT, reportPath)}\``,
    ""
  ];
  return lines.join("\n");
}

export { evaluate, extractMetrics, renderSummary };

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const [report, config] = await Promise.all([
    readFile(options.report, "utf8").then(JSON.parse),
    readFile(options.config, "utf8").then(JSON.parse)
  ]);
  const metrics = extractMetrics(report);
  const result = evaluate(metrics, config.policyBenchmark);
  const summary = renderSummary(result, options.report);

  await mkdir(path.dirname(options.summary), { recursive: true });
  await writeFile(options.summary, summary, "utf8");
  process.stdout.write(summary);

  const githubStepSummary = process.env.GITHUB_STEP_SUMMARY;
  if (githubStepSummary) await writeFile(githubStepSummary, summary, { flag: "a" });
  if (!result.pass) process.exitCode = 1;
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  main().catch((error) => {
    console.error(`Policy benchmark gate error: ${error.message}`);
    process.exitCode = 1;
  });
}
