#!/usr/bin/env node

import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseArguments(argv) {
  const options = {
    report: path.join(ROOT, "artifacts/benchmark/metrics.json"),
    summary: path.join(ROOT, "artifacts/benchmark/summary.md")
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--report" || argument === "--summary") {
      if (!argv[index + 1]) throw new Error(`${argument} requires a value`);
      options[argument.slice(2)] = path.resolve(ROOT, argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

async function existingFile(candidate) {
  try {
    const details = await stat(candidate);
    return details.isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

async function findProducedReport(target) {
  const candidates = [
    target,
    path.join(ROOT, "reports/benchmark.json"),
    path.join(ROOT, "reports/benchmark-results.json"),
    path.join(ROOT, "attack-lab/benchmark/results.json"),
    path.join(ROOT, "attack-lab/benchmark/report.json"),
    path.join(ROOT, "attack-lab/benchmark/metrics.json")
  ];
  for (const candidate of candidates) {
    if (await existingFile(candidate)) return candidate;
  }
  return undefined;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  if (!packageJson.scripts?.bench) {
    throw new Error("package.json must define the reproducible `bench` script");
  }

  await mkdir(path.dirname(options.report), { recursive: true });
  await rm(options.report, { force: true });

  const relativeReport = path.relative(ROOT, options.report);
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(command, ["run", "bench", "--", "--output", relativeReport], {
    cwd: ROOT,
    env: {
      ...process.env,
      GUARDMCP_BENCHMARK_REPORT: options.report,
      BENCHMARK_REPORT_PATH: options.report,
      BENCHMARK_OUTPUT: options.report
    },
    encoding: "utf8"
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error) throw result.error;
  const producerFailed = result.status !== 0;

  const producedReport = await findProducedReport(options.report);
  if (!producedReport) {
    throw new Error(
      `Benchmark completed without a JSON report. Write metrics to ${relativeReport} or honor GUARDMCP_BENCHMARK_REPORT.`
    );
  }
  if (path.resolve(producedReport) !== path.resolve(options.report)) {
    await copyFile(producedReport, options.report);
  }

  // Parse once here so malformed producer output fails before the gate process.
  const report = JSON.parse(await readFile(options.report, "utf8"));
  await writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const validator = path.join(ROOT, "scripts/ci/validate-policy-benchmark.mjs");
  const validation = spawnSync(process.execPath, [
    validator,
    "--report", options.report,
    "--summary", options.summary
  ], { cwd: ROOT, stdio: "inherit" });
  if (validation.error) throw validation.error;
  if (producerFailed) {
    const note = [
      "",
      `> The benchmark producer exited with code ${result.status}. Its additional checks also remain mandatory.`,
      ""
    ].join("\n");
    await writeFile(options.summary, note, { flag: "a" });
    if (process.env.GITHUB_STEP_SUMMARY) {
      await writeFile(process.env.GITHUB_STEP_SUMMARY, note, { flag: "a" });
    }
    console.error(`Benchmark producer exited with code ${result.status}; preserving its failure after report validation.`);
  }
  if (producerFailed || validation.status !== 0) process.exitCode = validation.status || result.status || 1;
}

main().catch((error) => {
  console.error(`Policy benchmark runner error: ${error.message}`);
  process.exitCode = 1;
});
