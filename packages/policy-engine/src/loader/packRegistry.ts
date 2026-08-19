// Pack scan orchestration + enable/disable state store (GMCP-14, FR-POL-02
// §3/§4/§5). `loadPolicyPacks` walks `policy-packs/<pack-id>/`, parses each
// manifest and policy file (file-level isolation — one bad file never stops
// the rest, task spec §2), resolves id collisions, and returns a
// `PackRegistry` the Gateway can query/enable/disable in-process.

import { readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Action, EvaluationStrategy, Policy } from "../types.js";
import { loadError, type PolicyLoadError } from "./errors.js";
import { parsePolicyFile } from "./parsePolicyFile.js";
import { parseYamlWithSchema } from "./parseYaml.js";
import { packManifestSchema } from "./policySchema.js";
import {
  findManifestPath,
  listYamlFilesFlat,
  scanPackDirectories,
  type PackDirectoryEntry
} from "./scanPackDirectory.js";

export interface PackState {
  packId: string;
  name: string;
  description?: string;
  defaultAction: Action;
  evaluationStrategy: EvaluationStrategy;
  /** Parent pack references (`"default@^1.0.0"` or bare `"default"`), manifest `extends` (FR-POL-03 §4.3/§6). */
  extends: string[];
  enabled: boolean;
  policies: Policy[];
  loadedAt: string;
  errors: PolicyLoadError[];
}

export interface PackSummary {
  packId: string;
  name: string;
  policyCount: number;
  enabled: boolean;
}

export interface LoadPolicyPacksOptions {
  /**
   * Packs that must load with zero errors. A failure inside one of these is
   * escalated to `level: "critical"` so Gateway boot can decide whether to
   * fail-closed (task spec §4 / NFR-03); the loader itself never throws.
   * Default: `["default", "korean-pii"]`.
   */
  requiredPacks?: string[];
}

const DEFAULT_REQUIRED_PACKS = ["default", "korean-pii"];

export class PackRegistry {
  private readonly packs: Map<string, PackState>;
  private readonly rootErrors: PolicyLoadError[];

  constructor(states: PackState[], rootErrors: PolicyLoadError[] = []) {
    this.packs = new Map(states.map((state) => [state.packId, state]));
    this.rootErrors = rootErrors;
  }

  listPacks(): PackState[] {
    return [...this.packs.values()];
  }

  getPack(packId: string): PackState | undefined {
    return this.packs.get(packId);
  }

  /** Top-level errors not tied to any single pack (e.g. missing root dir). */
  getRootErrors(): PolicyLoadError[] {
    return this.rootErrors;
  }

  /** Every accumulated error, root-level first, then each pack in scan order. */
  getAllErrors(): PolicyLoadError[] {
    return [...this.rootErrors, ...this.listPacks().flatMap((pack) => pack.errors)];
  }

  enablePack(packId: string): boolean {
    const pack = this.packs.get(packId);
    if (!pack) return false;
    pack.enabled = true;
    return true;
  }

  disablePack(packId: string): boolean {
    const pack = this.packs.get(packId);
    if (!pack) return false;
    pack.enabled = false;
    return true;
  }

  /** Policies from enabled packs whose own `enabled` flag isn't `false`, priority-ascending. */
  getActivePolicies(): Policy[] {
    return this.listPacks()
      .filter((pack) => pack.enabled)
      .flatMap((pack) => pack.policies)
      .filter((policy) => policy.enabled !== false)
      .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
  }

  getActivePolicyCount(): number {
    return this.getActivePolicies().length;
  }

  /** One row per pack (including disabled ones, for the policy-tab tree view). */
  getActivePackSummary(): PackSummary[] {
    return this.listPacks().map((pack) => ({
      packId: pack.packId,
      name: pack.name,
      policyCount: pack.policies.length,
      enabled: pack.enabled
    }));
  }

  /**
   * Flattens `packId`'s manifest `extends` chain into one policy list (FR-POL-03 §4.3, ported
   * 1:1 from the Gateway's former `resolveRuntimePolicies` so swapping the static generated
   * pack table for this runtime registry is not itself a behavior change). Parent policies come
   * first; a child policy with the same `id` as an inherited one overrides it (`Map` dedup keeps
   * the last write). `enabled`/`disabled` pack state is intentionally ignored here — this walks
   * the manifest graph by id, independent of the runtime enable/disable toggle.
   */
  resolvePolicies(packId: string, resolving: Set<string> = new Set()): Policy[] {
    if (resolving.has(packId)) throw new Error(`Policy pack cycle at ${packId}`);
    const pack = this.packs.get(packId);
    if (!pack) throw new Error(`Unknown policy pack ${packId}`);
    const next = new Set(resolving).add(packId);
    const inherited = pack.extends.flatMap((reference) =>
      this.resolvePolicies(reference.split("@")[0] ?? reference, next)
    );
    return [...new Map([...inherited, ...pack.policies].map((policy) => [policy.id, policy])).values()];
  }
}

export async function loadPolicyPacks(rootDir: string, options: LoadPolicyPacksOptions = {}): Promise<PackRegistry> {
  const requiredPacks = options.requiredPacks ?? DEFAULT_REQUIRED_PACKS;
  const resolvedRoot = resolve(rootDir);
  const baseDir = dirname(resolvedRoot);

  let entries: PackDirectoryEntry[];
  try {
    entries = await scanPackDirectories(resolvedRoot);
  } catch (error) {
    return new PackRegistry([], [
      loadError({
        file: toDisplayPath(baseDir, resolvedRoot),
        ruleId: "root:not_found",
        message: `정책 팩 루트 디렉터리를 찾을 수 없습니다: ${rootDir} (${message(error)})`,
        level: "critical"
      })
    ]);
  }

  interface PackMeta {
    name: string;
    description?: string;
    defaultAction: Action;
    evaluationStrategy: EvaluationStrategy;
    extends: string[];
    enabled: boolean;
    errors: PolicyLoadError[];
  }

  const packMeta = new Map<string, PackMeta>();
  const loadedPolicies: { packId: string; policy: Policy; filePath: string }[] = [];

  for (const entry of entries) {
    // `loadPack` collects errors as data rather than throwing, but it's not
    // load-bearing to enumerate every failure mode inside it — a single pack
    // (e.g. one with an adversarial manifest) must never be able to take
    // down the whole scan, so any escaped throw is caught here too.
    let meta: PackMeta;
    let policies: { policy: Policy; filePath: string }[];
    try {
      ({ meta, policies } = await loadPack(entry, baseDir));
    } catch (error) {
      meta = {
        name: entry.packId,
        defaultAction: "allow",
        evaluationStrategy: "severity-max",
        extends: [],
        enabled: true,
        errors: [
          loadError({
            file: toDisplayPath(baseDir, entry.packDir),
            ruleId: "pack:load_failed",
            message: `정책 팩을 불러오지 못했습니다: ${message(error)}`
          })
        ]
      };
      policies = [];
    }
    packMeta.set(entry.packId, meta);
    for (const item of policies) loadedPolicies.push({ packId: entry.packId, ...item });
  }

  const finalPolicies = new Map<string, Policy[]>();
  for (const packId of packMeta.keys()) finalPolicies.set(packId, []);

  // Required packs must win any id collision regardless of directory scan
  // order — an optional pack that happens to sort before a required one
  // (e.g. alphabetically ahead of "default") must never be able to shadow
  // a required pack's policy id.
  const requiredPackSet = new Set(requiredPacks);
  const orderedPolicies = [
    ...loadedPolicies.filter((item) => requiredPackSet.has(item.packId)),
    ...loadedPolicies.filter((item) => !requiredPackSet.has(item.packId))
  ];

  const idFirstSeenAt = new Map<string, { filePath: string; packId: string }>();
  for (const { packId, policy, filePath } of orderedPolicies) {
    const firstSeen = idFirstSeenAt.get(policy.id);
    if (firstSeen) {
      // A pack (required or not) trying to squat an id a required pack
      // already claimed is itself a critical signal, independent of
      // whether the squatter happens to be required.
      const level = requiredPackSet.has(firstSeen.packId) ? "critical" : undefined;
      packMeta.get(packId)?.errors.push(
        loadError({
          file: filePath,
          ruleId: "id:duplicate",
          message: `정책 id "${policy.id}"가 이미 사용 중입니다 (처음 정의된 위치: ${firstSeen.filePath})`,
          ...(level ? { level } : {})
        })
      );
      continue;
    }
    idFirstSeenAt.set(policy.id, { filePath, packId });
    finalPolicies.get(packId)?.push(policy);
  }

  const loadedAt = new Date().toISOString();
  const states: PackState[] = [...packMeta.entries()].map(([packId, meta]) => ({
    packId,
    name: meta.name,
    ...(meta.description !== undefined ? { description: meta.description } : {}),
    defaultAction: meta.defaultAction,
    evaluationStrategy: meta.evaluationStrategy,
    extends: meta.extends,
    enabled: meta.enabled,
    policies: finalPolicies.get(packId) ?? [],
    loadedAt,
    errors: meta.errors
  }));

  const rootErrors: PolicyLoadError[] = [];
  for (const requiredId of requiredPacks) {
    const state = states.find((candidate) => candidate.packId === requiredId);
    if (!state) {
      rootErrors.push(
        loadError({
          file: toDisplayPath(baseDir, resolvedRoot),
          ruleId: "required_pack:missing",
          message: `필수 정책 팩이 없습니다: ${requiredId}`,
          level: "critical"
        })
      );
    } else if (state.errors.length > 0) {
      state.errors = state.errors.map((error) => ({ ...error, level: "critical" }));
    }
  }

  return new PackRegistry(states, rootErrors);
}

async function loadPack(
  entry: PackDirectoryEntry,
  baseDir: string
): Promise<{
  meta: {
    name: string;
    description?: string;
    defaultAction: Action;
    evaluationStrategy: EvaluationStrategy;
    extends: string[];
    enabled: boolean;
    errors: PolicyLoadError[];
  };
  policies: { policy: Policy; filePath: string }[];
}> {
  const errors: PolicyLoadError[] = [];
  const manifestPath = await findManifestPath(entry.packDir);

  let name = entry.packId;
  let description: string | undefined;
  let defaultAction: Action = "allow";
  let evaluationStrategy: EvaluationStrategy = "severity-max";
  let extendsRefs: string[] = [];
  let enabled = true;
  let defaultDryRun = false;
  let declaredPolicyPaths: string[] | undefined;

  if (manifestPath) {
    const displayManifestPath = toDisplayPath(baseDir, manifestPath);
    let manifestText: string | undefined;
    try {
      manifestText = await readFile(manifestPath, "utf8");
    } catch (error) {
      errors.push(
        loadError({
          file: displayManifestPath,
          ruleId: "manifest:read_failed",
          message: `팩 매니페스트를 읽을 수 없습니다: ${message(error)}`
        })
      );
    }

    if (manifestText !== undefined) {
      const { value, errors: manifestErrors } = parseYamlWithSchema(manifestText, displayManifestPath, packManifestSchema);
      errors.push(...manifestErrors);
      if (value) {
        if (value.name !== undefined) name = value.name;
        if (value.description !== undefined) description = value.description;
        if (value.default_action !== undefined) defaultAction = value.default_action;
        if (value.evaluation_strategy !== undefined) evaluationStrategy = value.evaluation_strategy;
        if (value.extends !== undefined) extendsRefs = value.extends;
        if (value.enabled !== undefined) enabled = value.enabled;
        if (value.default_dry_run !== undefined) defaultDryRun = value.default_dry_run;
        if (value.policies !== undefined) {
          declaredPolicyPaths = await resolveDeclaredPolicyPaths(entry, value.policies, displayManifestPath, errors);
        }
      }
    }
  }

  let policyFilePaths: string[];
  if (declaredPolicyPaths) {
    policyFilePaths = declaredPolicyPaths;
  } else {
    // No manifest (or a manifest without `policies:`) falls back to listing whatever `.yaml`/
    // `.yml` files currently exist under the pack directory. Unlike the `declaredPolicyPaths`
    // branch above — where a deleted-but-still-listed file is a `manifest.policies:missing_file`
    // load error (FR-POL-03 §4.4: hot-reload refuses to swap on any error) — this path has no
    // fixed list to compare against, so deleting a file here just silently shrinks the pack on
    // the next successful reload. This is the accepted behavior only because every shipped pack
    // under policy-packs/ declares an explicit `policies:` list; an operational pack is expected
    // to keep doing so.
    try {
      policyFilePaths = await listYamlFilesFlat(entry.packDir);
    } catch (error) {
      errors.push(
        loadError({
          file: toDisplayPath(baseDir, entry.packDir),
          ruleId: "pack_dir:read_failed",
          message: `팩 디렉터리를 읽을 수 없습니다: ${message(error)}`
        })
      );
      policyFilePaths = [];
    }
  }

  const policies: { policy: Policy; filePath: string }[] = [];
  for (const filePath of policyFilePaths) {
    const displayPath = toDisplayPath(baseDir, filePath);
    let text: string;
    try {
      text = await readFile(filePath, "utf8");
    } catch (error) {
      errors.push(
        loadError({ file: displayPath, ruleId: "file:not_found", message: `정책 파일을 읽을 수 없습니다: ${message(error)}` })
      );
      continue;
    }

    const { policy: parsed, errors: fileErrors } = parsePolicyFile(text, displayPath);
    errors.push(...fileErrors);
    if (!parsed) continue;
    // SPEC-POL-04 §3.1: `default_dry_run: true` only fills in for a policy that leaves its own
    // `dry_run` unset — an explicit `dry_run: false` on the policy file always wins over the
    // pack's default, the same "explicit beats inherited" rule `enabled`/`default_action`
    // already follow elsewhere in this loader.
    const policy = parsed.dry_run === undefined && defaultDryRun ? { ...parsed, dry_run: true } : parsed;

    if (policy.pack !== entry.packId) {
      errors.push(
        loadError({
          file: displayPath,
          ruleId: "pack:mismatch",
          message: `정책의 pack 값("${policy.pack}")이 소속 디렉터리("${entry.packId}")와 일치하지 않습니다`
        })
      );
      continue;
    }

    policies.push({ policy, filePath: displayPath });
  }

  return {
    meta: {
      name,
      ...(description !== undefined ? { description } : {}),
      defaultAction,
      evaluationStrategy,
      extends: extendsRefs,
      enabled,
      errors
    },
    policies
  };
}

async function resolveDeclaredPolicyPaths(
  entry: PackDirectoryEntry,
  declared: string[],
  displayManifestPath: string,
  errors: PolicyLoadError[]
): Promise<string[]> {
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const declaredPath of declared) {
    if (seen.has(declaredPath)) {
      errors.push(
        loadError({
          file: displayManifestPath,
          ruleId: "manifest.policies:duplicate_entry",
          message: `policies 목록에 ${declaredPath}가 중복 등록되었습니다`
        })
      );
      continue;
    }
    seen.add(declaredPath);

    const absolutePath = join(entry.packDir, declaredPath);
    if (!(await isFile(absolutePath))) {
      errors.push(
        loadError({
          file: displayManifestPath,
          ruleId: "manifest.policies:missing_file",
          message: `policies 목록에 등록된 파일을 찾을 수 없습니다: ${declaredPath}`
        })
      );
      continue;
    }
    resolved.push(absolutePath);
  }
  return resolved;
}

async function isFile(path: string): Promise<boolean> {
  return stat(path)
    .then((info) => info.isFile())
    .catch(() => false);
}

function toDisplayPath(baseDir: string, absolutePath: string): string {
  return relative(baseDir, absolutePath).split(sep).join("/");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
