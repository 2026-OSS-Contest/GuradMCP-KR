import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { parse } from "yaml";

const root = "policy-packs";
const allowedActions = new Set(["allow", "warn", "require_approval", "block", "mask_then_allow"]);
const allowedSeverities = new Set(["info", "low", "medium", "high", "critical"]);
const allowedDirections = new Set(["request", "response", "any"]);
const allowedTrust = new Set(["trusted", "limited", "untrusted", "any"]);
const failures: string[] = [];
const ids = new Map<string, string>();
const packs = new Map<string, Record<string, unknown>>();
let count = 0;

for (const packName of await directoryNames(root)) {
  const packPath = join(root, packName);
  const manifestPath = join(packPath, "pack.yaml");
  const manifest = await readYaml(manifestPath);
  if (manifest) {
    packs.set(packName, manifest);
    requireFields(manifestPath, manifest, ["name", "version", "dsl_version", "default_action", "evaluation_strategy", "policies"]);
    if (manifest.name !== packName) failures.push(`${manifestPath}: name must equal directory ${packName}`);
    if (manifest.dsl_version !== 1) failures.push(`${manifestPath}: dsl_version must be 1`);
    if (!allowedActions.has(String(manifest.default_action))) failures.push(`${manifestPath}: invalid default_action`);
    if (!["severity-max", "first-match"].includes(String(manifest.evaluation_strategy))) failures.push(`${manifestPath}: invalid evaluation_strategy`);
    if (!Array.isArray(manifest.policies) || manifest.policies.length === 0) failures.push(`${manifestPath}: policies must be a non-empty list`);
    for (const relative of Array.isArray(manifest.policies) ? manifest.policies : []) {
      if (typeof relative !== "string" || !await isFile(join(packPath, relative))) failures.push(`${manifestPath}: missing policy file ${String(relative)}`);
    }
  }

  for (const path of await policyFiles(packPath)) {
    const fileName = path.split("/").at(-1) ?? path;
    if (fileName === "pack.yaml" || fileName === "pack.yml") continue;
    count += 1;
    const policy = await readYaml(path);
    if (!policy) continue;
    requireFields(path, policy, ["id", "pack", "version", "priority", "match", "action", "severity"]);
    const id = String(policy.id ?? "");
    if (ids.has(id)) failures.push(`${path}: duplicate id ${id} (first seen in ${ids.get(id)})`);
    else if (id) ids.set(id, path);
    if (policy.pack !== packName) failures.push(`${path}: pack must equal ${packName}`);
    if (policy.version !== 1) failures.push(`${path}: version must be 1`);
    if (!isInteger(policy.priority) || policy.priority < 0) failures.push(`${path}: priority must be a non-negative integer`);
    if (!isRecord(policy.match) || Object.keys(policy.match).length === 0) failures.push(`${path}: match must be a non-empty object`);
    validateMatch(path, policy.match);
    if (!allowedActions.has(String(policy.action))) failures.push(`${path}: invalid action ${String(policy.action)}`);
    if (!allowedSeverities.has(String(policy.severity))) failures.push(`${path}: invalid severity ${String(policy.severity)}`);
    if (policy.action === "require_approval") validateApproval(path, policy.approval);
    else if (policy.approval !== undefined) failures.push(`${path}: approval is only valid with require_approval`);
  }
}

for (const [packName, manifest] of packs) {
  for (const reference of Array.isArray(manifest.extends) ? manifest.extends : []) {
    const parent = String(reference).split("@")[0];
    if (!parent || !packs.has(parent)) failures.push(`${join(root, packName, "pack.yaml")}: unknown extended pack ${String(reference)}`);
    if (parent === packName) failures.push(`${join(root, packName, "pack.yaml")}: pack cannot extend itself`);
  }
}

if (count === 0) failures.push("policy-packs: no policy YAML files found");
if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Validated ${count} policies in ${packs.size} packs.\n`);
}

function validateMatch(path: string, value: unknown): void {
  if (!isRecord(value)) return;
  if (value.direction !== undefined && !allowedDirections.has(String(value.direction))) failures.push(`${path}: invalid match.direction`);
  if (value.tool !== undefined && (typeof value.tool !== "string" || value.tool.length === 0)) failures.push(`${path}: match.tool must be a string`);
  if (value.server_trust !== undefined && !allowedTrust.has(String(value.server_trust))) failures.push(`${path}: invalid match.server_trust`);
  if (value.args !== undefined && !isRecord(value.args)) failures.push(`${path}: match.args must be an object`);
  if (value.detections !== undefined && !isRecord(value.detections)) failures.push(`${path}: match.detections must be an object`);
  if (isRecord(value.risk_score)) {
    const { gte, lte } = value.risk_score;
    if (gte !== undefined && (!isFiniteNumber(gte) || gte < 0 || gte > 100)) failures.push(`${path}: risk_score.gte must be 0..100`);
    if (lte !== undefined && (!isFiniteNumber(lte) || lte < 0 || lte > 100)) failures.push(`${path}: risk_score.lte must be 0..100`);
    if (isFiniteNumber(gte) && isFiniteNumber(lte) && gte > lte) failures.push(`${path}: risk_score.gte must not exceed lte`);
  } else if (value.risk_score !== undefined) failures.push(`${path}: match.risk_score must be an object`);
}

function validateApproval(path: string, value: unknown): void {
  if (!isRecord(value)) {
    failures.push(`${path}: require_approval needs an approval block`);
    return;
  }
  const timeout = value.timeout_seconds;
  if (!isInteger(timeout) || timeout < 1 || timeout > 3600) failures.push(`${path}: approval.timeout_seconds must be 1..3600`);
  if (value.on_timeout !== "block") failures.push(`${path}: approval.on_timeout must be block`);
  if (value.allow_masked_approval !== undefined && typeof value.allow_masked_approval !== "boolean") failures.push(`${path}: allow_masked_approval must be boolean`);
}

function requireFields(path: string, value: Record<string, unknown>, fields: string[]): void {
  for (const field of fields) if (value[field] === undefined) failures.push(`${path}: missing ${field}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

async function readYaml(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = parse(await readFile(path, "utf8"));
    if (!isRecord(value)) {
      failures.push(`${path}: YAML document must be an object`);
      return undefined;
    }
    return value;
  } catch (error) {
    failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function directoryNames(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map(({ name }) => name).sort();
}

async function policyFiles(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async (entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? policyFiles(child) : [child];
  }));
  return nested.flat().filter((file) => [".yaml", ".yml"].includes(extname(file))).sort();
}

async function isFile(path: string): Promise<boolean> {
  return stat(path).then((value) => value.isFile()).catch(() => false);
}
