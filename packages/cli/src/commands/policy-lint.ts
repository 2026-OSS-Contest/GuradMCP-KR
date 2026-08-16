// `guardmcp policy lint` (design doc §3.3) — reuses @guardmcp/policy-engine's
// loader as-is (schema + regex-safety + require_approval checks); this file
// adds only file discovery and duplicate-id bookkeeping across the linted
// set, the same two things scripts/validate-policies.ts adds on top of the
// same schema for its own (pack-manifest-level) rule set. The two validators
// intentionally cover different scopes:
//   - `guardmcp policy lint` — the design doc's checklist (§3.3), runnable
//     against a single file, a directory, or a glob, with no pack.yaml
//     required. Meant for fast, local, single-file feedback while authoring.
//   - `npm run policy:validate` — the stricter whole-repo CI gate (manifest
//     semver, dsl_version, evaluation_strategy, extends-cycle/version
//     compatibility, reasonCode allowlist, pack.yaml `policies` listing).
//     Still authoritative for policy-pack PRs; this command does not replace it.
import { glob, readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import {
  loadPolicyPacks,
  parsePolicyFile,
  parseYamlWithSchema,
  packManifestSchema,
  type PolicyLoadError
} from "../../../policy-engine/src/index.js";
import { readPositionals, readValue, UsageError } from "../lib/argv.js";

const MANIFEST_NAMES = new Set(["pack.yaml", "pack.meta.yaml"]);

export async function policyLint(argv: string[]): Promise<void> {
  const packName = readValue(argv, "--pack");
  const [pathArg] = readPositionals(argv, ["--pack"]);
  if (!packName && !pathArg) {
    throw new UsageError("guardmcp policy lint <path-or-glob> | guardmcp policy lint --pack <packName>");
  }
  if (packName && pathArg) {
    throw new UsageError("guardmcp policy lint: use either <path-or-glob> or --pack, not both");
  }

  const { errors, scope } = packName ? await lintPack(packName) : await lintPath(pathArg as string);

  if (errors.length === 0) {
    process.stdout.write(`${scope} 검증 완료. 오류 없음.\n`);
    return;
  }

  for (const error of errors) {
    const location = error.line !== undefined ? `:${error.line}${error.column !== undefined ? `:${error.column}` : ""}` : "";
    process.stdout.write(`${error.file}${location}  [${error.ruleId}]  ${error.message}\n`);
  }
  process.stdout.write(`\n${errors.length}개 오류 (${scope}).\n`);
  process.exitCode = 1;
}

async function lintPack(packName: string): Promise<{ errors: PolicyLoadError[]; scope: string }> {
  const registry = await loadPolicyPacks("policy-packs");
  const pack = registry.getPack(packName);
  if (!pack) throw new UsageError(`알 수 없는 정책 팩입니다: ${packName}`);
  // A pack directory with no manifest-declared and no flat *.yaml files loads
  // cleanly (zero policies, zero errors) rather than throwing — that is the
  // right default for the gateway's boot-time loader, but a lint gate that
  // reports "no errors" without having read anything is worse than useless.
  if (pack.policies.length === 0 && pack.errors.length === 0) {
    throw new UsageError(`정책 팩 ${packName}에서 검증할 정책 파일을 찾지 못했습니다`);
  }
  return { errors: pack.errors, scope: `정책 팩 ${packName} (정책 ${pack.policies.length}개)` };
}

async function lintPath(pathArg: string): Promise<{ errors: PolicyLoadError[]; scope: string }> {
  const files = await resolveFiles(pathArg);
  if (files.length === 0) throw new UsageError(`일치하는 정책 파일이 없습니다: ${pathArg}`);

  const errors: PolicyLoadError[] = [];
  const idFirstSeenAt = new Map<string, string>();
  for (const file of files) {
    const displayPath = relative(process.cwd(), file);
    const text = await readFile(file, "utf8");
    if (MANIFEST_NAMES.has(basename(file))) {
      const { errors: manifestErrors } = parseYamlWithSchema(text, displayPath, packManifestSchema);
      errors.push(...manifestErrors);
      continue;
    }

    const { policy, errors: fileErrors } = parsePolicyFile(text, displayPath);
    errors.push(...fileErrors);
    if (!policy) continue;

    const firstSeenAt = idFirstSeenAt.get(policy.id);
    if (firstSeenAt) {
      errors.push({
        file: displayPath,
        ruleId: "id:duplicate",
        message: `정책 id "${policy.id}"가 이미 사용 중입니다 (처음 정의된 위치: ${firstSeenAt})`,
        level: "error"
      });
    } else {
      idFirstSeenAt.set(policy.id, displayPath);
    }
  }
  return { errors, scope: `파일 ${files.length}개` };
}

async function resolveFiles(pathArg: string): Promise<string[]> {
  if (/[*?[\]{}]/.test(pathArg)) {
    const matches: string[] = [];
    for await (const match of glob(pathArg)) matches.push(resolve(match));
    return matches.sort();
  }

  const target = resolve(pathArg);
  const info = await stat(target).catch(() => undefined);
  if (!info) throw new UsageError(`경로를 찾을 수 없습니다: ${pathArg}`);
  return info.isDirectory() ? walkYaml(target) : [target];
}

async function walkYaml(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const child = join(root, entry.name);
    return entry.isDirectory() ? walkYaml(child) : Promise.resolve([child]);
  }));
  return nested.flat().filter((file) => [".yaml", ".yml"].includes(extname(file))).sort();
}
