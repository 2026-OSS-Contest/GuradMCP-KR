// Pack scan orchestration + enable/disable state store (GMCP-14, FR-POL-02
// §3/§4/§5). `loadPolicyPacks` walks `policy-packs/<pack-id>/`, parses each
// manifest and policy file (file-level isolation — one bad file never stops
// the rest, task spec §2), resolves id collisions, and returns a
// `PackRegistry` the Gateway can query/enable/disable in-process.

import { readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Action, Policy } from "../types.js";
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
    enabled: boolean;
    errors: PolicyLoadError[];
  }

  const packMeta = new Map<string, PackMeta>();
  const loadedPolicies: { packId: string; policy: Policy; filePath: string }[] = [];

  for (const entry of entries) {
    const { meta, policies } = await loadPack(entry, baseDir);
    packMeta.set(entry.packId, meta);
    for (const item of policies) loadedPolicies.push({ packId: entry.packId, ...item });
  }

  const finalPolicies = new Map<string, Policy[]>();
  for (const packId of packMeta.keys()) finalPolicies.set(packId, []);

  const idFirstSeenAt = new Map<string, string>();
  for (const { packId, policy, filePath } of loadedPolicies) {
    const firstSeenAt = idFirstSeenAt.get(policy.id);
    if (firstSeenAt) {
      packMeta.get(packId)?.errors.push(
        loadError({
          file: filePath,
          ruleId: "id:duplicate",
          message: `정책 id "${policy.id}"가 이미 사용 중입니다 (처음 정의된 위치: ${firstSeenAt})`
        })
      );
      continue;
    }
    idFirstSeenAt.set(policy.id, filePath);
    finalPolicies.get(packId)?.push(policy);
  }

  const loadedAt = new Date().toISOString();
  const states: PackState[] = [...packMeta.entries()].map(([packId, meta]) => ({
    packId,
    name: meta.name,
    ...(meta.description !== undefined ? { description: meta.description } : {}),
    defaultAction: meta.defaultAction,
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
  meta: { name: string; description?: string; defaultAction: Action; enabled: boolean; errors: PolicyLoadError[] };
  policies: { policy: Policy; filePath: string }[];
}> {
  const errors: PolicyLoadError[] = [];
  const manifestPath = await findManifestPath(entry.packDir);

  let name = entry.packId;
  let description: string | undefined;
  let defaultAction: Action = "allow";
  let enabled = true;
  let declaredPolicyPaths: string[] | undefined;

  if (manifestPath) {
    const displayManifestPath = toDisplayPath(baseDir, manifestPath);
    const text = await readFile(manifestPath, "utf8");
    const { value, errors: manifestErrors } = parseYamlWithSchema(text, displayManifestPath, packManifestSchema);
    errors.push(...manifestErrors);
    if (value) {
      if (value.name !== undefined) name = value.name;
      if (value.description !== undefined) description = value.description;
      if (value.default_action !== undefined) defaultAction = value.default_action;
      if (value.enabled !== undefined) enabled = value.enabled;
      if (value.policies !== undefined) {
        declaredPolicyPaths = await resolveDeclaredPolicyPaths(entry, value.policies, displayManifestPath, errors);
      }
    }
  }

  const policyFilePaths = declaredPolicyPaths ?? (await listYamlFilesFlat(entry.packDir));

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

    const { policy, errors: fileErrors } = parsePolicyFile(text, displayPath);
    errors.push(...fileErrors);
    if (!policy) continue;

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
    meta: { name, ...(description !== undefined ? { description } : {}), defaultAction, enabled, errors },
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
