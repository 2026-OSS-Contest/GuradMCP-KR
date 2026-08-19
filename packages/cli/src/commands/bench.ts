// `guardmcp bench` (design doc §3.2). All judgment (recall/FPR/p95/etc. and
// the pass/fail thresholds) lives in attack-lab/benchmark/benchmark.ts; this
// file only formats and, for `compare`, diffs two already-judged reports.
//
// The design doc lists `--dataset`/`--policy-pack` filters for `bench run`.
// runBenchmark() always evaluates every dataset against the full
// policy-packs/ tree (the same scope `npm run bench` uses) and has no
// subsetting hook, so those two flags are not implemented here rather than
// accepted as a no-op — see docs/cli/README.md.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runBenchmark, type BenchmarkReport } from "../../../../attack-lab/benchmark/benchmark.js";
import { runDryRunBenchmark, type DryRunBenchmarkReport } from "../../../../attack-lab/benchmark/dryRunBenchmark.js";
import { loadPolicyPacks } from "../../../policy-engine/src/index.js";
import { readFlag, readValue, UsageError } from "../lib/argv.js";

const SUPPORTED_FORMATS = new Set(["json", "md", "html"]);

/** §7.1's own example names `attack-lab/datasets/normal-kr-v1`, a dataset this repo hasn't
 *  shipped; the closest existing one with real (`label: false`) Korean-context negatives is
 *  this file — see attack-lab/benchmark/benchmark.ts's own use of it. `--dataset` overrides. */
const DEFAULT_DRY_RUN_DATASET = "attack-lab/datasets/pii-benchmark.json";

export async function benchRun(argv: string[]): Promise<void> {
  if (readFlag(argv, "--dry-run-only")) {
    await benchDryRunOnly(argv);
    return;
  }

  const format = readValue(argv, "--format") ?? "json";
  if (!SUPPORTED_FORMATS.has(format)) {
    throw new UsageError(`--format must be json, md, or html, got ${format}`);
  }

  const jsonPath = resolve(process.env.GUARDMCP_BENCHMARK_REPORT ?? "reports/benchmark.json");
  const requestedOutput = readValue(argv, "--output");
  const outputPath = requestedOutput !== undefined ? resolve(requestedOutput) : undefined;

  const report = await runBenchmark();
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const rendered = format === "json" ? json : format === "md" ? renderMarkdown(report) : await renderHtml(report);

  if (outputPath === undefined) {
    // No explicit destination: `bench compare` needs a JSON report to read,
    // so one always lands at the stable default path — the same behavior
    // as before --format existed. A rendered md/html report with no chosen
    // filename only makes sense on stdout, below.
    await writeReportFile(jsonPath, json);
  } else {
    // Save exactly what was asked for, in the format that was asked for —
    // not a JSON file wearing a .md/.html extension.
    await writeReportFile(outputPath, rendered);
    // Still guarantee the JSON copy `bench compare` needs, unless --output
    // already points at that same path (format is then already json).
    if (format !== "json" && outputPath !== jsonPath) {
      await writeReportFile(jsonPath, json);
    }
  }

  process.stdout.write(rendered);
  if (!report.passed) process.exitCode = 1;
}

async function writeReportFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

/**
 * SPEC-POL-04 §7.1/§7.2: replay a labeled-normal dataset in shadow mode and report each
 * matched policy's FPR. `--fail-on-fpr <threshold>` is the CI gate §7.2 asks for (policy-pack
 * PRs fail the build past it); posting to the Control Plane (§6.2/§6.1 `benchmark` block) is
 * best-effort — a CI run has no Control Plane reachable, and this must report what it measured
 * either way, not fail the run over who's listening (same posture as ./dryRunStats.ts's own
 * "consulted, not required").
 */
async function benchDryRunOnly(argv: string[]): Promise<void> {
  const datasetPath = readValue(argv, "--dataset") ?? DEFAULT_DRY_RUN_DATASET;
  const failOnFprArg = readValue(argv, "--fail-on-fpr");
  const failOnFpr = failOnFprArg !== undefined ? Number(failOnFprArg) : undefined;
  if (failOnFprArg !== undefined && (!Number.isFinite(failOnFpr) || (failOnFpr as number) < 0 || (failOnFpr as number) > 1)) {
    throw new UsageError(`--fail-on-fpr must be a number between 0 and 1, got ${failOnFprArg}`);
  }

  const registry = await loadPolicyPacks("policy-packs");
  const policies = registry.getActivePolicies();
  const report = await runDryRunBenchmark({ datasetPath, policies, mode: "shadow-all" });

  process.stdout.write(`${renderDryRunReport(report)}\n`);

  if (process.env.CONTROL_PLANE_URL) await postBenchmarkResults(report);

  if (failOnFpr !== undefined) {
    const failures = report.perPolicy.filter(({ fpr }) => fpr > failOnFpr);
    if (failures.length > 0) {
      process.stderr.write(
        `FPR gate failed (> ${failOnFpr}): ${failures.map(({ policyId, fpr }) => `${policyId}=${fpr.toFixed(4)}`).join(", ")}\n`
      );
      process.exitCode = 1;
    }
  }
}

function renderDryRunReport(report: DryRunBenchmarkReport): string {
  const lines = [
    `guardmcp bench run --dry-run-only  (dataset: ${report.datasetVersion}, ${report.normalSampleCount} normal samples, mode: ${report.mode})`,
    "",
    "policyId".padEnd(40) + "fpCount".padStart(10) + "fpr".padStart(10)
  ];
  for (const { policyId, falsePositiveCount, fpr } of report.perPolicy) {
    lines.push(policyId.padEnd(40) + String(falsePositiveCount).padStart(10) + `${(fpr * 100).toFixed(2)}%`.padStart(10));
  }
  if (report.perPolicy.length === 0) lines.push("(no policy matched any normal sample)");
  return lines.join("\n");
}

/** Fire-and-forget-ish: logged on failure, never thrown — a report this CLI already printed
 *  to stdout must not be lost because the Control Plane happened to be unreachable. */
async function postBenchmarkResults(report: DryRunBenchmarkReport): Promise<void> {
  const baseUrl = process.env.CONTROL_PLANE_URL as string;
  for (const { policyId, falsePositiveCount } of report.perPolicy) {
    const url = `${baseUrl.replace(/\/$/, "")}/api/v1/policies/${encodeURIComponent(policyId)}/benchmark-results`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          datasetVersion: report.datasetVersion,
          normalSampleCount: report.normalSampleCount,
          falsePositiveCount
        })
      });
      if (!response.ok) {
        process.stderr.write(`warning: control plane rejected benchmark result for ${policyId} (${response.status})\n`);
      }
    } catch (error) {
      process.stderr.write(
        `warning: could not post benchmark result for ${policyId}: ${error instanceof Error ? error.message : String(error)}\n`
      );
    }
  }
}

export async function benchCompare(argv: string[]): Promise<void> {
  const [baselinePath, currentPath] = argv.filter((token) => !token.startsWith("--"));
  if (!baselinePath || !currentPath) {
    throw new UsageError("guardmcp bench compare <baseline.json> <current.json>");
  }

  const baseline = await readReport(baselinePath);
  const current = await readReport(currentPath);

  // §7 leaves absolute-vs-relative regression thresholds open; this picks
  // absolute tolerances (chosen so a single flaky sample near a threshold
  // does not flip the gate) and re-asserts current's own fixed KPI
  // thresholds, so a report that regresses *and* still clears KPIs is
  // still flagged: baseline is a floor, not a substitute for the KPI gate.
  const tolerances = { recall: 0.01, fpr: 0.01, p95Ms: 5 };
  const regressions: string[] = [];
  if (current.metrics.recall < baseline.metrics.recall - tolerances.recall) {
    regressions.push(`recall ${pct(baseline.metrics.recall)} -> ${pct(current.metrics.recall)}`);
  }
  if (current.metrics.fpr > baseline.metrics.fpr + tolerances.fpr) {
    regressions.push(`fpr ${pct(baseline.metrics.fpr)} -> ${pct(current.metrics.fpr)}`);
  }
  if (current.metrics.p95Ms > baseline.metrics.p95Ms + tolerances.p95Ms) {
    regressions.push(`p95 ${baseline.metrics.p95Ms.toFixed(2)}ms -> ${current.metrics.p95Ms.toFixed(2)}ms`);
  }

  const rows: Array<[string, number, number, string]> = [
    ["recall", baseline.metrics.recall, current.metrics.recall, "higher is better"],
    ["fpr", baseline.metrics.fpr, current.metrics.fpr, "lower is better"],
    ["precision", baseline.metrics.precision, current.metrics.precision, "higher is better"],
    ["p95Ms", baseline.metrics.p95Ms, current.metrics.p95Ms, "lower is better"]
  ];
  const lines = ["metric        baseline      current       note", ...rows.map(([name, base, curr, note]) =>
    `${name.padEnd(13)} ${format(name, base).padEnd(13)} ${format(name, curr).padEnd(13)} ${note}`
  )];
  process.stdout.write(`${lines.join("\n")}\n\n`);

  if (!current.passed) process.stdout.write("current report does not meet the fixed KPI thresholds (see its own \"thresholds\" field).\n");
  if (regressions.length > 0) process.stdout.write(`regressed vs baseline (tolerance recall/fpr ±1pt, p95 ±5ms): ${regressions.join(", ")}\n`);

  const passed = current.passed && regressions.length === 0;
  process.stdout.write(passed ? "PASS\n" : "FAIL\n");
  if (!passed) process.exitCode = 1;
}

function format(name: string, value: number): string {
  return name === "p95Ms" ? `${value.toFixed(2)}ms` : pct(value);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

async function readReport(path: string): Promise<BenchmarkReport> {
  const target = resolve(path);
  let text: string;
  try {
    text = await readFile(target, "utf8");
  } catch (error) {
    throw new UsageError(`benchmark 리포트를 읽을 수 없습니다: ${path} (${error instanceof Error ? error.message : String(error)})`);
  }
  try {
    return JSON.parse(text) as BenchmarkReport;
  } catch (error) {
    throw new UsageError(`benchmark 리포트가 올바른 JSON이 아닙니다: ${path} (${error instanceof Error ? error.message : String(error)})`);
  }
}

function kpiRows(report: BenchmarkReport): Array<[string, string, string, boolean]> {
  const { metrics, thresholds } = report;
  return [
    ["Recall", pct(metrics.recall), `>= ${pct(thresholds.recall)}`, metrics.recall >= thresholds.recall],
    ["FPR", pct(metrics.fpr), `<= ${pct(thresholds.fpr)}`, metrics.fpr <= thresholds.fpr],
    ["Precision", pct(metrics.precision), "-", true],
    ["p95 latency", `${metrics.p95Ms.toFixed(2)}ms`, `<= ${thresholds.p95Ms}ms`, metrics.p95Ms <= thresholds.p95Ms],
    ["Average latency", `${metrics.averageMs.toFixed(2)}ms`, "-", true]
  ];
}

function renderMarkdown(report: BenchmarkReport): string {
  const lines = [
    "# guardmcp bench run",
    "",
    `Overall: **${report.passed ? "PASS" : "FAIL"}**`,
    "",
    "| Metric | Actual | Required | Result |",
    "| --- | ---: | ---: | :---: |",
    ...kpiRows(report).map(([name, actual, required, ok]) => `| ${name} | ${actual} | ${required} | ${ok ? "PASS" : "FAIL"} |`),
    ""
  ];
  return lines.join("\n");
}

// The design-token package (packages/design-tokens, GMCP-116) has no
// package.json import surface for reading its raw CSS text — its "exports"
// only lets an ESM/CSS bundler resolve "@guardmcp/design-tokens/tokens.css"
// as an asset, not a Node readFile target — so this reaches into its source
// the same way this CLI already reaches into attack-lab/ and policy-engine's
// loader: a plain relative path, no bundler involved.
const designTokensUrl = new URL("../../../../packages/design-tokens/tokens.css", import.meta.url);

/**
 * Only the `:root { ... }` primitive block (colors, spacing, radius, opacity,
 * shadow) is reused. The stylesheet's typography classes hard-code the
 * console's Figma fonts ("SUIT", "JetBrains Mono"), which this CLI does not
 * ship and will not fetch — a generated report has to render correctly
 * offline. So those classes are left out entirely and the report defines its
 * own font-family with a system font stack instead.
 */
async function loadDesignTokenVariables(): Promise<string> {
  const css = await readFile(designTokensUrl, "utf8");
  const match = /:root\s*\{[^}]*\}/.exec(css);
  if (!match) throw new Error(`design tokens root block not found in ${designTokensUrl.pathname}`);
  return match[0];
}

async function renderHtml(report: BenchmarkReport): Promise<string> {
  const tokens = await loadDesignTokenVariables();
  const rows = kpiRows(report);
  const rowsHtml = rows
    .map(([name, actual, required, ok]) => `
        <tr>
          <td>${escapeHtml(name)}</td>
          <td class="numeric mono">${escapeHtml(actual)}</td>
          <td class="numeric mono">${escapeHtml(required)}</td>
          <td class="numeric"><span class="badge ${ok ? "badge-pass" : "badge-fail"}">${ok ? "PASS" : "FAIL"}</span></td>
        </tr>`)
    .join("");

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>guardmcp bench run</title>
<style>
${tokens}

:root {
  /* GMCP-97: the shared token file's typography classes carry fonts this
     report doesn't ship (SUIT, JetBrains Mono) — use system fonts instead. */
  --report-font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  --report-font-mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: var(--primitive-padding-p-32);
  background: var(--primitive-color-grayscale-950);
  color: var(--primitive-color-grayscale-white);
  font-family: var(--report-font-sans);
  font-size: var(--primitive-font-size-base);
  line-height: 1.5;
}

.mono { font-family: var(--report-font-mono); }

h1 {
  font-size: var(--primitive-font-size-2xl);
  margin: 0 0 var(--primitive-margin-m-8);
}

.meta {
  color: var(--primitive-color-grayscale-400);
  font-size: var(--primitive-font-size-sm);
  margin: 0 0 var(--primitive-margin-m-24);
}

.badge {
  display: inline-block;
  padding: var(--primitive-padding-p-4) var(--primitive-padding-p-12);
  border-radius: var(--primitive-radius-rounded-full);
  font-size: var(--primitive-font-size-sm);
  font-weight: 700;
}

.badge-pass {
  background: var(--primitive-opacity-allow-alpha-25);
  color: var(--primitive-verdict-allow);
}

.badge-fail {
  background: var(--primitive-opacity-block-alpha-25);
  color: var(--primitive-verdict-block);
}

table {
  width: 100%;
  border-collapse: collapse;
  background: var(--primitive-color-grayscale-900);
  border: 1px solid var(--primitive-color-grayscale-800);
  border-radius: var(--primitive-radius-rounded-lg);
  overflow: hidden;
}

th, td {
  text-align: left;
  padding: var(--primitive-padding-p-12) var(--primitive-padding-p-16);
  border-bottom: 1px solid var(--primitive-color-grayscale-800);
}

th {
  font-size: var(--primitive-font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--primitive-color-grayscale-400);
}

tr:last-child td { border-bottom: none; }

.numeric { text-align: right; }
</style>
</head>
<body>
<h1>guardmcp bench run <span class="badge ${report.passed ? "badge-pass" : "badge-fail"}">${report.passed ? "PASS" : "FAIL"}</span></h1>
<p class="meta">Generated ${escapeHtml(report.generatedAt)}</p>
<table>
  <thead>
    <tr><th>Metric</th><th class="numeric">Actual</th><th class="numeric">Required</th><th class="numeric">Result</th></tr>
  </thead>
  <tbody>${rowsHtml}
  </tbody>
</table>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
