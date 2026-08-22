// CLI entry for the Benchmark Runner (GMCP-97 §4: "guardmcp bench ──→
// services/control-plane... " is aspirational; there is no separate service —
// `npm run bench` and `guardmcp bench run` both call runBenchmark() below and
// serialize the same report, the same split as attack-lab/runner/run.ts.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { collectBenchmarkSamples, runBenchmark } from "./benchmark.js";

const args = process.argv.slice(2);
const outputFlag = args.indexOf("--output");
const outputPath = resolve(
  outputFlag >= 0 && args[outputFlag + 1]
    ? args[outputFlag + 1] as string
    : process.env.GUARDMCP_BENCHMARK_REPORT ?? "reports/benchmark.json"
);
// fix-api.md §7: GET /benchmark/samples's own file, alongside the report — same env-var-with-
// a-default pattern, kept separate from `--output`/GUARDMCP_BENCHMARK_REPORT so a caller that
// only wants the aggregate report (the CLI's own `bench run`/`bench compare`) is unaffected.
const samplesPath = resolve(process.env.GUARDMCP_BENCHMARK_SAMPLES ?? "reports/benchmark-samples.json");

const report = await runBenchmark();
const samples = await collectBenchmarkSamples();

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
await mkdir(dirname(samplesPath), { recursive: true });
await writeFile(samplesPath, `${JSON.stringify({ samples }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
