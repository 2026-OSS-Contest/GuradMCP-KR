// CLI entry for the Benchmark Runner (GMCP-97 §4: "guardmcp bench ──→
// services/control-plane... " is aspirational; there is no separate service —
// `npm run bench` and `guardmcp bench run` both call runBenchmark() below and
// serialize the same report, the same split as attack-lab/runner/run.ts.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runBenchmark } from "./benchmark.js";

const args = process.argv.slice(2);
const outputFlag = args.indexOf("--output");
const outputPath = resolve(
  outputFlag >= 0 && args[outputFlag + 1]
    ? args[outputFlag + 1] as string
    : process.env.GUARDMCP_BENCHMARK_REPORT ?? "reports/benchmark.json"
);

const report = await runBenchmark();

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
