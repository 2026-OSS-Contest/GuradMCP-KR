// `guardmcp demo` (design doc §3.1) — a thin wrapper around the Attack Lab
// runner (attack-lab/runner/runner.ts). It holds no judgment logic of its own:
// verdicts, grading, and the guarded/vulnerable split all come from
// runCatalog(), the same function `npm run attacklab` calls.
//
// The design doc describes `demo` as driving real MCP traffic against a
// `--endpoint` gateway. attack-lab/runner/runner.ts deliberately does not do
// that ("the gateway's HTTP surface is deliberately not involved: a scenario
// has to be reproducible in CI with nothing running") and names this CLI
// command as one of the two callers of runCatalog(). This command follows the
// shipped runner rather than the doc's HTTP framing, so there is no
// `--endpoint` flag here — see docs/cli/README.md for the full rationale.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadCatalog, runCatalog, type RunMode, type RunReport } from "../../../../attack-lab/runner/runner.js";
import { readPositionals, readValue, UsageError } from "../lib/argv.js";

const FLAGS_WITH_VALUES = ["--target", "--seed", "--record"];

export async function demoList(): Promise<void> {
  const { catalog } = await loadCatalog();
  const lines = catalog.scenarios.map((scenario) => {
    const note = scenario.automation.mode === "manual" ? `  (수동, ${scenario.automation.blockedBy} 대기)` : "";
    return `  ${scenario.id.padEnd(6)} ${(scenario.threat ?? "-").padEnd(5)} ${scenario.expectedControl.verdict.padEnd(16)} ${scenario.title}${note}`;
  });
  process.stdout.write([`시나리오 ${catalog.scenarios.length}개 (catalog v${catalog.version})`, "", ...lines, ""].join("\n"));
}

export async function demoRun(argv: string[]): Promise<void> {
  const [scenarioId] = readPositionals(argv, FLAGS_WITH_VALUES);
  if (!scenarioId) throw new UsageError("guardmcp demo run <scenarioId|threatId|all> [--target guarded|vulnerable] [--seed <n>] [--record <path>]");

  const mode = readMode(argv);
  const seed = readValue(argv, "--seed");
  const recordPath = readValue(argv, "--record");
  // Verdicts are deterministic by construction (the pipeline has no randomness
  // of its own); --seed only pins the session id in the report so repeated
  // demo runs are byte-identical there. Event ids and timestamps still vary
  // run to run — this flag does not freeze those.
  const sessionId = seed !== undefined ? `attacklab-seed-${seed}` : undefined;

  let report: RunReport;
  try {
    report = await runCatalog({
      mode,
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(scenarioId !== "all" ? { only: [scenarioId] } : {})
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }

  if (recordPath !== undefined) {
    const target = resolve(recordPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
  }

  process.stdout.write(render(report));
  if (!report.passed) process.exitCode = 1;
}

function readMode(argv: string[]): RunMode {
  const value = readValue(argv, "--target") ?? "guarded";
  if (value !== "guarded" && value !== "vulnerable") {
    throw new UsageError(`--target must be guarded or vulnerable, got ${value}`);
  }
  return value;
}

function render(report: RunReport): string {
  const lines = [`demo run — ${report.mode} (session ${report.sessionId})`, ""];
  const mark = { pass: "PASS", gap: "GAP ", fail: "FAIL", ungraded: "RUN " } as const;
  for (const run of report.scenarios) {
    lines.push(`  ${mark[run.grade]}  ${run.scenarioId}  ${(run.threat ?? "-").padEnd(4)} ${run.actualVerdict.padEnd(16)} ${run.title}`);
    for (const failure of run.failures) lines.push(`        ${failure}`);
  }
  for (const skip of report.skipped) {
    lines.push(`  SKIP  ${skip.scenarioId}  not reproducible yet (${skip.blockedBy})`);
  }
  const { total, passed, gaps, failed, skipped, blockedAttacks, attacks } = report.summary;
  lines.push("");
  if (report.mode === "vulnerable") {
    lines.push(
      `  ${total} scenario(s) reproduced with no gateway in the path.`,
      `  ${blockedAttacks}/${attacks} attack scenario(s) were stopped — this is the "before" side, so it should be 0.`,
      ""
    );
    return lines.join("\n");
  }
  lines.push(
    `  ${passed}/${total} scenario(s) matched their expected control point.`,
    `  ${failed} failed, ${gaps} declared but not yet enforced, ${skipped} not reproducible yet.`,
    `  ${blockedAttacks}/${attacks} attack scenario(s) were stopped at require_approval or stronger.`,
    ""
  );
  return lines.join("\n");
}
