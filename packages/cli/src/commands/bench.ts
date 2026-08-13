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
import { readValue, UsageError } from "../lib/argv.js";

const SUPPORTED_FORMATS = new Set(["json", "md"]);

export async function benchRun(argv: string[]): Promise<void> {
  const format = readValue(argv, "--format") ?? "json";
  if (!SUPPORTED_FORMATS.has(format)) {
    throw new UsageError(
      format === "html"
        ? "--format html is not implemented yet (design doc §7 leaves the console design-token question open); use json or md"
        : `--format must be json or md, got ${format}`
    );
  }

  const outputPath = readValue(argv, "--output") ?? process.env.GUARDMCP_BENCHMARK_REPORT ?? "reports/benchmark.json";
  const report = await runBenchmark();

  // --output always gets the full JSON report regardless of --format, even
  // when the path ends in .md: `bench compare` needs JSON, and a file that
  // silently changed shape depending on a flag would break it. --format only
  // controls what's printed to stdout.
  const target = resolve(outputPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);

  process.stdout.write(format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));
  if (!report.passed) process.exitCode = 1;
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

function renderMarkdown(report: BenchmarkReport): string {
  const { metrics, thresholds } = report;
  const rows: Array<[string, string, string, boolean]> = [
    ["Recall", pct(metrics.recall), `>= ${pct(thresholds.recall)}`, metrics.recall >= thresholds.recall],
    ["FPR", pct(metrics.fpr), `<= ${pct(thresholds.fpr)}`, metrics.fpr <= thresholds.fpr],
    ["Precision", pct(metrics.precision), "-", true],
    ["p95 latency", `${metrics.p95Ms.toFixed(2)}ms`, `<= ${thresholds.p95Ms}ms`, metrics.p95Ms <= thresholds.p95Ms],
    ["Average latency", `${metrics.averageMs.toFixed(2)}ms`, "-", true]
  ];
  const lines = [
    "# guardmcp bench run",
    "",
    `Overall: **${report.passed ? "PASS" : "FAIL"}**`,
    "",
    "| Metric | Actual | Required | Result |",
    "| --- | ---: | ---: | :---: |",
    ...rows.map(([name, actual, required, ok]) => `| ${name} | ${actual} | ${required} | ${ok ? "PASS" : "FAIL"} |`),
    ""
  ];
  return lines.join("\n");
}
