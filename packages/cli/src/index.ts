// guardmcp CLI entry point (design doc §3). A thin dispatcher only — every
// command delegates to the module that owns the actual judgment logic
// (attack-lab/runner, attack-lab/benchmark, @guardmcp/policy-engine's
// loader). See docs/cli/README.md for the full command reference and the
// scope decisions made against the GMCP-97 design doc.
import { benchCompare, benchRun } from "./commands/bench.js";
import { demoList, demoRun } from "./commands/demo.js";
import { UsageError } from "./lib/argv.js";

const USAGE = `guardmcp <command> [options]

Commands:
  guardmcp demo list
  guardmcp demo run <scenarioId|threatId|all> [--target guarded|vulnerable] [--seed <n>] [--record <path>]
  guardmcp bench run [--format json|md] [--output <path>]
  guardmcp bench compare <baseline.json> <current.json>

See docs/cli/README.md for details and scope notes.
`;

async function main(): Promise<void> {
  const [group, subcommand, ...rest] = process.argv.slice(2);

  if (!group || group === "--help" || group === "-h") {
    process.stdout.write(USAGE);
    return;
  }

  if (group === "demo") {
    if (subcommand === "list") return demoList();
    if (subcommand === "run") return demoRun(rest);
    throw new UsageError(`unknown demo subcommand: ${subcommand ?? "(none)"}\n\n${USAGE}`);
  }

  if (group === "bench") {
    if (subcommand === "run") return benchRun(rest);
    if (subcommand === "compare") return benchCompare(rest);
    throw new UsageError(`unknown bench subcommand: ${subcommand ?? "(none)"}\n\n${USAGE}`);
  }

  throw new UsageError(`unknown command: ${group}\n\n${USAGE}`);
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 64;
    return;
  }
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
