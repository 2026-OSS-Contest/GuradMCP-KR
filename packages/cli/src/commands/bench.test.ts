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

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "guardmcp-bench-"));
    output = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });
    process.exitCode = undefined;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it("bench run rejects --format html without running the benchmark (deferred per design doc §7)", async () => {
    await expect(benchRun(["--format", "html"])).rejects.toThrow(/not implemented yet/);
  });

  it("bench run writes the report and exits clean when the shipped policies pass", async () => {
    const outputPath = join(dir, "report.json");
    await benchRun(["--format", "json", "--output", outputPath]);
    expect(process.exitCode).toBeUndefined();
    const written = JSON.parse(await readFile(outputPath, "utf8"));
    expect(written.passed).toBe(true);
    expect(written.metrics.recall).toBeGreaterThanOrEqual(0.9);
  }, 20000);

  it("bench run --format md still writes full JSON to --output, since bench compare needs JSON", async () => {
    const outputPath = join(dir, "report.md");
    await benchRun(["--format", "md", "--output", outputPath]);
    expect(process.exitCode).toBeUndefined();
    expect(output.join("")).toContain("| Metric | Actual | Required | Result |");
    const written = JSON.parse(await readFile(outputPath, "utf8"));
    expect(written.passed).toBe(true);
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
