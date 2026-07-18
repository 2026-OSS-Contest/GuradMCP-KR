import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const validator = resolve("scripts/validate-policies.ts");
const tsxCli = resolve("node_modules/tsx/dist/cli.mjs");

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it("rejects unknown fields, invalid detection lists, and malformed regexes", async () => {
  const root = await fixtureRoot();
  await writePack(root, "broken", [], `
id: broken_policy
pack: broken
version: 1
priority: 1
unknown_top_level: true
match:
  server_trsut: untrusted
  args:
    path_regex: '['
  detections:
    any_of: SECRET
  risk_score:
    gt: 10
action: block
severity: high
`);
  const result = runValidator(root);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("unknown field unknown_top_level");
  expect(result.stderr).toContain("unknown field server_trsut");
  expect(result.stderr).toContain("safe JavaScript regex subset");
  expect(result.stderr).toContain("must be a non-empty string list");
  expect(result.stderr).toContain("unknown field gt");
});

it("rejects an ambiguous quantified alternation before it can cause ReDoS", async () => {
  const root = await fixtureRoot();
  await writePack(root, "unsafe", [], `
id: unsafe_regex
pack: unsafe
version: 1
priority: 1
match:
  args:
    value_regex: '(a|aa)+$'
action: block
severity: high
`);
  const result = runValidator(root);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("safe JavaScript regex subset");
});

it("rejects transitive pack extension cycles", async () => {
  const root = await fixtureRoot();
  await writePack(root, "alpha", ["beta@^1.0.0"], validPolicy("alpha"));
  await writePack(root, "beta", ["alpha@^1.0.0"], validPolicy("beta"));
  const result = runValidator(root);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("extends cycle");
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(`${tmpdir()}/guardmcp-policy-validator-`);
  temporaryDirectories.push(root);
  return root;
}

async function writePack(root: string, name: string, parents: string[], policy: string): Promise<void> {
  const directory = resolve(root, "policy-packs", name);
  await mkdir(resolve(directory, "policies"), { recursive: true });
  await writeFile(resolve(directory, "pack.yaml"), `
name: ${name}
version: 1.0.0
dsl_version: 1
default_action: allow
evaluation_strategy: severity-max
extends: [${parents.join(", ")}]
policies: [policies/rule.yaml]
`);
  await writeFile(resolve(directory, "policies/rule.yaml"), policy);
}

function validPolicy(pack: string): string {
  return `
id: ${pack}_rule
pack: ${pack}
version: 1
priority: 1
match: { tool: read_file }
action: block
severity: high
`;
}

function runValidator(root: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [tsxCli, validator], { cwd: root, encoding: "utf8" });
}
