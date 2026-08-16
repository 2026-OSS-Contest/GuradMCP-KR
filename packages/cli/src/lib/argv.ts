// Hand-rolled flag parsing, matching the style already used by
// attack-lab/runner/run.ts and attack-lab/benchmark/run.ts (AGENTS.md: don't
// add a dependency when a platform API — here, plain argv scanning — suffices).

export function readValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function readFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

/** Positional arguments: everything that isn't a recognized `--flag` or its value. */
export function readPositionals(argv: string[], flagsWithValues: string[], booleanFlags: string[] = []): string[] {
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (flagsWithValues.includes(token)) {
      index += 1;
      continue;
    }
    if (booleanFlags.includes(token)) continue;
    if (token.startsWith("--")) continue;
    positionals.push(token);
  }
  return positionals;
}

export class UsageError extends Error {}
