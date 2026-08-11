// CLI entry for the Attack Scenario Runner (GMCP-55).
//
// `npm run attacklab` runs the whole catalog guarded and fails on any scenario
// whose verdict disagrees with what the catalog claims. That is the CI shape:
// a regression in a detector rule, a policy priority, or the risk formula shows
// up here as a named scenario rather than a moved aggregate number.
//
// The `guardmcp` CLI (GMCP-97) and `POST /attacklab/run` (control plane) are the
// other two entry points named in FR-LAB-01; both call the same runCatalog()
// rather than reimplementing the loop.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runCatalog, type RunMode, type RunReport } from "./runner.js";

const argv = process.argv.slice(2);
const mode = readMode();
const only = readList("--only");
const outputPath = resolve(readValue("--output") ?? process.env.GUARDMCP_ATTACKLAB_REPORT ?? "reports/attacklab.json");

const report = await runCatalog({ mode, ...(only.length > 0 ? { only } : {}) });
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(render(report));
if (!report.passed) process.exitCode = 1;

function render(value: RunReport): string {
  const lines = [`Attack Lab — ${value.mode} (session ${value.sessionId})`, ""];
  const mark = { pass: "PASS", gap: "GAP ", fail: "FAIL", ungraded: "RUN " } as const;
  for (const run of value.scenarios) {
    lines.push(`  ${mark[run.grade]}  ${run.scenarioId}  ${(run.threat ?? "-").padEnd(4)} ${run.actualVerdict.padEnd(16)} ${run.title}`);
    for (const failure of run.failures) lines.push(`        ${failure}`);
  }
  for (const skip of value.skipped) {
    lines.push(`  SKIP  ${skip.scenarioId}  not reproducible yet (${skip.blockedBy})`);
  }
  const { total, passed, gaps, failed, skipped, blockedAttacks, attacks } = value.summary;
  lines.push("");
  if (value.mode === "vulnerable") {
    // Nothing to grade here. The number that matters is how much got through.
    lines.push(
      `  ${total} scenarios reproduced with no gateway in the path.`,
      `  ${blockedAttacks}/${attacks} attack scenarios were stopped — this is the "before" side, so it should be 0.`,
      ""
    );
    return lines.join("\n");
  }
  lines.push(
    `  ${passed}/${total} scenarios matched their expected control point.`,
    `  ${failed} failed, ${gaps} declared but not yet enforced, ${skipped} not reproducible yet.`,
    `  ${blockedAttacks}/${attacks} attack scenarios were stopped at require_approval or stronger.`,
    ""
  );
  if (gaps > 0) {
    lines.push("  Not yet enforced — the catalog names no policy for these:");
    for (const run of value.scenarios.filter(({ grade }) => grade === "gap")) {
      lines.push(`    ${run.scenarioId}  target ${run.expectedVerdict}, actual ${run.actualVerdict}  ${run.title}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function readMode(): RunMode {
  const value = readValue("--mode") ?? "guarded";
  if (value !== "guarded" && value !== "vulnerable") {
    process.stderr.write(`--mode must be guarded or vulnerable, got ${value}\n`);
    process.exit(64);
  }
  return value;
}

function readValue(flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

/** `--only A-01,T-07` selects by scenario id or by threat id. */
function readList(flag: string): string[] {
  return (readValue(flag) ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}
