# guardmcp CLI

**English** | [한국어](README.md)

`packages/cli` (`@guardmcp/cli`) is a thin orchestration layer that scripts scenario replay, benchmarking, and policy validation (GMCP-97). This CLI holds no judgment logic of its own — every command is a thin wrapper over an already-shipped module.

| Command | Delegates to |
| --- | --- |
| `guardmcp demo` | `runCatalog()` in `attack-lab/runner/runner.ts` |
| `guardmcp bench` | `runBenchmark()` in `attack-lab/benchmark/benchmark.ts` |
| `guardmcp policy lint` | `@guardmcp/policy-engine`'s loader (`parsePolicyFile`, `loadPolicyPacks`) |

## Running it

There is no build artifact — sources run directly through `tsx` (see "Why tsx" below). Three equivalent invocation paths:

```bash
npm run cli -- <command>                     # from the repo root, via npm scripts
npx tsx packages/cli/src/index.ts <command>   # directly via tsx
guardmcp <command>                            # workspace bin symlink after npm install
```

## Commands

### `guardmcp demo`

Replays the Attack Lab catalog (T-01..T-09, `attack-lab/scenarios/catalog.json`).

```
guardmcp demo list
guardmcp demo run <scenarioId|threatId|all> [--target guarded|vulnerable] [--seed <n>] [--record <path>]
```

* `<scenarioId|threatId|all>`: a scenario id (`A-01`), a threat id (`T-01`, runs every scenario under it), or `all` (the whole catalog).
* `--target`: `guarded` (default, goes through the gateway pipeline) or `vulnerable` (no inspection, reproduces the "before" side). Maps to `runCatalog()`'s `mode` option.
* `--seed`: pins the report's `sessionId` to `attacklab-seed-<n>`. Verdicts are already deterministic (the pipeline has no randomness of its own) regardless of `--seed`; it does not pin each step's `eventId` or timestamp — those still vary run to run even though the verdicts and grades in the `--record` output do not.
* `--record <path>`: writes the run report (JSON) to the given path.
* Exit code: non-zero (1) if any scenario grades `fail` in `guarded` mode. `vulnerable` mode is never graded, so it always exits 0.

### `guardmcp bench`

Computes recall/FPR/precision/p95-latency KPIs across all of `policy-packs/`, `attack-lab/datasets/`, and `attack-lab/policy-fixtures/`.

```
guardmcp bench run [--format json|md|html] [--output <path>]
guardmcp bench compare <baseline.json> <current.json>
```

* `--format`: controls stdout only — `json` (default, full report), `md` (a compact KPI table), or `html` (a single, self-contained HTML file styled with the same design tokens as the console, no external requests). `html` inlines `packages/design-tokens`'s color/spacing/radius tokens as-is, but not its typography classes' "SUIT"/"JetBrains Mono" fonts — this CLI doesn't ship those, so the report defines its own system font stack instead (it has to render correctly offline). See "Scope decisions" below for the reasoning.
* `--output <path>`: when given, saves exactly what `--format` produced at that path (HTML for `--format html`, markdown for `md`). Omit it and no rendered file is written at all — only stdout gets it. Regardless of `--format`, the JSON report `bench compare` reads is always separately guaranteed at `reports/benchmark.json` (or the `GUARDMCP_BENCHMARK_REPORT` env var) — unless `--output` points at that exact path with `--format json`, in which case there's only the one file.
* `bench compare` diffs two report JSON files. It fails if `current` doesn't meet its own fixed KPI thresholds (recall ≥ 90%, FPR ≤ 5%, p95 ≤ 50ms, etc.) **or** if it regressed past a tolerance against `baseline` (recall −1pt, FPR +1pt, p95 +5ms). Either condition alone is enough to fail — the baseline comparison does not replace the KPI gate.
* Exit code: `bench run` is non-zero if the report's `passed` is false. `bench compare` is non-zero if either condition above is hit.

### `guardmcp policy lint`

Validates policy DSL (Appendix A) documents against schema and semantics.

```
guardmcp policy lint <path-or-glob>
guardmcp policy lint --pack <packName>
```

* `<path-or-glob>`: a single file, a directory (recursively collects `*.yaml`/`*.yml`), or a glob pattern (`policy-packs/**/*.yaml`).
* `--pack <name>`: scans all of `policy-packs/` and reports only the named pack's errors (still catches `id` collisions against other packs).
* Checks: required-field schema (`id`/`pack`/`priority`/`match`/`action`/`severity`), allowed sets for `action`/`severity`/`direction`, duplicate policy ids (within the linted file set), missing `approval.timeout_seconds`/`approval.on_timeout` on `require_approval`, and ReDoS-safety of `*_regex` fields.
* Exit code: non-zero if any error is found.
* **Relationship to `npm run policy:validate`**: this command does not replace the repo-wide CI gate. `npm run policy:validate` (`scripts/validate-policies.ts`) is stricter — it additionally checks manifest semver, `dsl_version`, the `evaluation_strategy` allowlist, that `pack.yaml`'s `policies` list matches the files on disk, `extends` cycle/version compatibility, and the `reasonCode` allowlist — and remains the CI gate for policy-pack PRs. `guardmcp policy lint` is for fast, per-file feedback while authoring.

## Scope decisions against the design doc

Decisions made where the implementation diverges from the design doc (including its §7 open questions), and why.

* **No `--endpoint` on `demo`**: the design doc describes `demo` as driving real MCP traffic against the gateway, but `attack-lab/runner/runner.ts` states outright that "the gateway's HTTP surface is deliberately not involved: a scenario has to be reproducible in CI with nothing running," and names the `guardmcp` CLI (GMCP-97) as one of the two callers of `runCatalog()`. This CLI follows the contract of the code that already exists.
* **No `--dataset`/`--policy-pack` on `bench run`**: `runBenchmark()` always evaluates the entire `policy-packs/` tree against a fixed dataset bundle and has no subsetting hook. Rather than accept flags that would be silently ignored, they are not exposed.
* **`bench run --format html` shares `packages/design-tokens`'s colors/spacing, not its fonts**: the design doc's §7 open question was resolved by GMCP-116 (splitting `packages/design-tokens` out of the console). This CLI inlines only the `:root` primitive-variable block from that package's `tokens.css`. The same file's typography classes (`.text-*`) assume the "SUIT"/"JetBrains Mono" web fonts, which this CLI neither ships nor fetches over the network, so those classes are left out entirely and the report's own CSS declares a system font stack (`ui-sans-serif, system-ui, ...` / `ui-monospace, ...`) instead.
* **No `policy lint --strict`**: the design doc describes `--strict` as promoting warnings to errors, but the current loader (`packages/policy-engine/src/loader`) only emits two levels, `error` and `critical` — there is no separate "warning" tier. Rather than accept a flag that can never change behavior, it isn't implemented.
* **`bench compare` regression policy (design doc §7 open question)**: chose absolute tolerances (recall/FPR ±1 percentage point, p95 +5ms) over a relative-change-rate policy, and added a re-assertion of `current`'s own fixed KPI thresholds on top — so a bad baseline can never become the new passing bar.

## Why tsx (no build output)

`packages/cli` reaches into `attack-lab/` (a plain TypeScript source tree with no `package.json` of its own) via relative imports. Building it with `tsc` and `rootDir: "src"`, the way `packages/gateway` and `packages/policy-engine` do, would reject those imports as outside `rootDir`. Instead this package follows the same pattern already used for `attack-lab/*.ts` and `scripts/*.ts`: sources run directly under `tsx`, and type checking is covered by the repo-root `tsconfig.tools.json` (which includes `packages/cli/**/*.ts`). `bin/guardmcp.mjs` registers that loader via `tsx/esm/api`'s `register()` and then dynamically imports `src/index.ts`.
