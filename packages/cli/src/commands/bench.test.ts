import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { benchCompare, benchRun } from "./bench.js";

interface MinimalReportOverrides { recall?: number; fpr?: number; p95Ms?: number; passed?: boolean }

function minimalReport(overrides: MinimalReportOverrides = {}): string {
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    metrics: { recall: 1, fpr: 0, precision: 1, p95Ms: 2, averageMs: 1, ...overrides },
    thresholds: { recall: 0.9, fpr: 0.05, p95Ms: 50 },
    passed: overrides.passed ?? true
  });
}

describe("guardmcp bench", () => {
  let dir: string;
  let output: string[];
  let previousReportEnv: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "guardmcp-bench-"));
    output = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });
    process.exitCode = undefined;
    // benchRun always guarantees a JSON report at this path (or an explicit
    // --output). Point it into the temp dir so these tests never write to
    // the repo's real reports/benchmark.json.
    previousReportEnv = process.env.GUARDMCP_BENCHMARK_REPORT;
    process.env.GUARDMCP_BENCHMARK_REPORT = join(dir, "default-report.json");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    if (previousReportEnv === undefined) delete process.env.GUARDMCP_BENCHMARK_REPORT;
    else process.env.GUARDMCP_BENCHMARK_REPORT = previousReportEnv;
    await rm(dir, { recursive: true, force: true });
  });

  it("bench run rejects an unsupported --format without running the benchmark", async () => {
    await expect(benchRun(["--format", "pdf"])).rejects.toThrow(/--format must be json, md, or html/);
  });

  it("bench run --format html --output saves the rendered HTML there, and still guarantees JSON for bench compare", async () => {
    const outputPath = join(dir, "report.html");
    await benchRun(["--format", "html", "--output", outputPath]);
    expect(process.exitCode).toBeUndefined();
    const html = await readFile(outputPath, "utf8");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("--primitive-verdict-allow");
    expect(html).toContain("badge-pass");
    // packages/design-tokens ships "SUIT"/"JetBrains Mono" font-family rules
    // on its typography classes; the report must not carry those, since it
    // has to render correctly offline without fetching those fonts.
    expect(html).not.toMatch(/font-family:\s*"(SUIT|JetBrains Mono)"/);
    expect(output.join("")).toBe(html);
    // bench compare reads JSON, not the .html file, so a copy must still
    // land at the default (env-directed) path even though --output was html.
    const jsonAtDefault = JSON.parse(await readFile(process.env.GUARDMCP_BENCHMARK_REPORT as string, "utf8"));
    expect(jsonAtDefault.passed).toBe(true);
  }, 20000);

  it("bench run writes the report and exits clean when the shipped policies pass", async () => {
    const outputPath = join(dir, "report.json");
    await benchRun(["--format", "json", "--output", outputPath]);
    expect(process.exitCode).toBeUndefined();
    const written = JSON.parse(await readFile(outputPath, "utf8"));
    expect(written.passed).toBe(true);
    expect(written.metrics.recall).toBeGreaterThanOrEqual(0.9);
  }, 20000);

  it("bench run --format json --output does not also write the default JSON path a second time", async () => {
    const outputPath = join(dir, "report.json");
    await benchRun(["--format", "json", "--output", outputPath]);
    expect(process.exitCode).toBeUndefined();
    await expect(readFile(process.env.GUARDMCP_BENCHMARK_REPORT as string, "utf8")).rejects.toThrow();
  }, 20000);

  it("bench run --format md --output saves markdown there, not JSON, and still guarantees JSON for bench compare", async () => {
    const outputPath = join(dir, "report.md");
    await benchRun(["--format", "md", "--output", outputPath]);
    expect(process.exitCode).toBeUndefined();
    const markdown = await readFile(outputPath, "utf8");
    expect(markdown).toContain("| Metric | Actual | Required | Result |");
    const jsonAtDefault = JSON.parse(await readFile(process.env.GUARDMCP_BENCHMARK_REPORT as string, "utf8"));
    expect(jsonAtDefault.passed).toBe(true);
  }, 20000);

  it("bench run --format html without --output only prints to stdout, but still guarantees JSON at the default path", async () => {
    await benchRun(["--format", "html"]);
    expect(process.exitCode).toBeUndefined();
    expect(output.join("")).toContain("<!doctype html>");
    const jsonAtDefault = JSON.parse(await readFile(process.env.GUARDMCP_BENCHMARK_REPORT as string, "utf8"));
    expect(jsonAtDefault.passed).toBe(true);
  }, 20000);

  it("bench compare passes when current matches baseline", async () => {
    const baseline = join(dir, "baseline.json");
    const current = join(dir, "current.json");
    await writeFile(baseline, minimalReport());
    await writeFile(current, minimalReport());
    await benchCompare([baseline, current]);
    expect(process.exitCode).toBeUndefined();
    expect(output.join("")).toContain("PASS");
  });

  it("bench compare fails when recall regresses beyond tolerance", async () => {
    const baseline = join(dir, "baseline.json");
    const current = join(dir, "current.json");
    await writeFile(baseline, minimalReport({ recall: 0.95 }));
    await writeFile(current, minimalReport({ recall: 0.90 }));
    await benchCompare([baseline, current]);
    expect(process.exitCode).toBe(1);
    expect(output.join("")).toContain("regressed vs baseline");
  });

  it("bench compare tolerates a sub-threshold wobble", async () => {
    const baseline = join(dir, "baseline.json");
    const current = join(dir, "current.json");
    await writeFile(baseline, minimalReport({ recall: 0.95 }));
    await writeFile(current, minimalReport({ recall: 0.945 }));
    await benchCompare([baseline, current]);
    expect(process.exitCode).toBeUndefined();
  });

  it("bench compare fails when current misses its own KPI thresholds even without a baseline regression", async () => {
    const baseline = join(dir, "baseline.json");
    const current = join(dir, "current.json");
    await writeFile(baseline, minimalReport());
    await writeFile(current, minimalReport({ passed: false }));
    await benchCompare([baseline, current]);
    expect(process.exitCode).toBe(1);
    expect(output.join("")).toContain("does not meet the fixed KPI thresholds");
  });

  it("bench compare requires both file arguments", async () => {
    await expect(benchCompare(["only-one.json"])).rejects.toThrow(/guardmcp bench compare/);
  });

  it("bench compare reports a clear error for a missing file", async () => {
    await expect(benchCompare([join(dir, "missing.json"), join(dir, "also-missing.json")]))
      .rejects.toThrow(/읽을 수 없습니다/);
  });
});
