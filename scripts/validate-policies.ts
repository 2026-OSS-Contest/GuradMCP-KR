import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, normalize, relative } from "node:path";
import { parse } from "yaml";
import {
  isSafePolicyRegex,
  reasonCodes,
} from "../packages/policy-engine/src/index.js";

const root = "policy-packs";
const allowedActions = new Set([
  "allow",
  "warn",
  "require_approval",
  "block",
  "mask_then_allow",
]);
const allowedSeverities = new Set([
  "info",
  "low",
  "medium",
  "high",
  "critical",
]);
const allowedDirections = new Set(["request", "response", "any"]);
const allowedReasonCodes = new Set<string>(reasonCodes);
const allowedGrades = new Set(["trusted", "limited", "untrusted"]);
const allowedTrust = new Set([...allowedGrades, "any"]);
const manifestFields = new Set([
  "name",
  "version",
  "description",
  "dsl_version",
  "default_action",
  "evaluation_strategy",
  "extends",
  "policies",
  "default_dry_run",
]);
const policyFields = new Set([
  "id",
  "pack",
  "version",
  "description",
  "priority",
  "match",
  "action",
  "severity",
  "message",
  "reasonCode",
  "enabled",
  "approval",
  "dry_run",
]);
const matchFields = new Set([
  "direction",
  "tool",
  "server_trust",
  "args",
  "detections",
  "risk_score",
]);
const detectionFields = new Set(["any_of", "all_of", "none_of", "min_count"]);
const riskFields = new Set(["gte", "lte"]);
const approvalFields = new Set([
  "timeout_seconds",
  "on_timeout",
  "allow_masked_approval",
]);
const failures: string[] = [];
const ids = new Map<string, string>();
const packs = new Map<string, Record<string, unknown>>();
let count = 0;

for (const packName of await directoryNames(root)) {
  const packPath = join(root, packName);
  const manifestPath = join(packPath, "pack.yaml");
  const manifest = await readYaml(manifestPath);
  const listedPolicyPaths = new Set<string>();
  if (manifest) {
    packs.set(packName, manifest);
    rejectUnknownFields(manifestPath, manifest, manifestFields);
    requireFields(manifestPath, manifest, [
      "name",
      "version",
      "dsl_version",
      "default_action",
      "evaluation_strategy",
      "policies",
    ]);
    if (manifest.name !== packName)
      failures.push(`${manifestPath}: name must equal directory ${packName}`);
    if (
      typeof manifest.version !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(manifest.version)
    )
      failures.push(`${manifestPath}: version must be semantic x.y.z`);
    if (manifest.dsl_version !== 1)
      failures.push(`${manifestPath}: dsl_version must be 1`);
    if (!allowedActions.has(String(manifest.default_action)))
      failures.push(`${manifestPath}: invalid default_action`);
    if (
      !["severity-max", "first-match"].includes(
        String(manifest.evaluation_strategy),
      )
    )
      failures.push(`${manifestPath}: invalid evaluation_strategy`);
    if (!Array.isArray(manifest.policies) || manifest.policies.length === 0)
      failures.push(`${manifestPath}: policies must be a non-empty list`);
    for (const relative of Array.isArray(manifest.policies)
      ? manifest.policies
      : []) {
      if (
        typeof relative !== "string" ||
        !relative.startsWith("policies/") ||
        normalize(relative).startsWith("..")
      ) {
        failures.push(
          `${manifestPath}: invalid policy path ${String(relative)}`,
        );
      } else {
        if (listedPolicyPaths.has(relative))
          failures.push(`${manifestPath}: duplicate policy path ${relative}`);
        listedPolicyPaths.add(relative);
        if (!(await isFile(join(packPath, relative))))
          failures.push(`${manifestPath}: missing policy file ${relative}`);
      }
    }
    if (
      manifest.extends !== undefined &&
      (!Array.isArray(manifest.extends) ||
        !manifest.extends.every((entry) => typeof entry === "string"))
    )
      failures.push(`${manifestPath}: extends must be a string list`);
    if (
      manifest.default_dry_run !== undefined &&
      typeof manifest.default_dry_run !== "boolean"
    )
      failures.push(`${manifestPath}: default_dry_run must be boolean`);
  }

  for (const path of await policyFiles(packPath)) {
    const fileName = path.split("/").at(-1) ?? path;
    if (fileName === "pack.yaml" || fileName === "pack.yml") continue;
    count += 1;
    const manifestRelative = relative(packPath, path);
    if (!listedPolicyPaths.has(manifestRelative))
      failures.push(`${path}: policy file must be listed in pack.yaml`);
    const policy = await readYaml(path);
    if (!policy) continue;
    rejectUnknownFields(path, policy, policyFields);
    requireFields(path, policy, [
      "id",
      "pack",
      "version",
      "priority",
      "match",
      "action",
      "severity",
    ]);
    const id = String(policy.id ?? "");
    if (ids.has(id))
      failures.push(
        `${path}: duplicate id ${id} (first seen in ${ids.get(id)})`,
      );
    else if (id) ids.set(id, path);
    if (policy.pack !== packName)
      failures.push(`${path}: pack must equal ${packName}`);
    if (policy.version !== 1) failures.push(`${path}: version must be 1`);
    if (policy.enabled !== undefined && typeof policy.enabled !== "boolean")
      failures.push(`${path}: enabled must be boolean`);
    if (policy.dry_run !== undefined && typeof policy.dry_run !== "boolean")
      failures.push(`${path}: dry_run must be boolean`);
    if (
      policy.description !== undefined &&
      typeof policy.description !== "string"
    )
      failures.push(`${path}: description must be a string`);
    if (policy.message !== undefined && typeof policy.message !== "string")
      failures.push(`${path}: message must be a string`);
    if (
      policy.reasonCode !== undefined &&
      !allowedReasonCodes.has(String(policy.reasonCode))
    )
      failures.push(`${path}: invalid reasonCode ${String(policy.reasonCode)}`);
    if (!isInteger(policy.priority) || policy.priority < 0)
      failures.push(`${path}: priority must be a non-negative integer`);
    if (!isRecord(policy.match) || Object.keys(policy.match).length === 0)
      failures.push(`${path}: match must be a non-empty object`);
    validateMatch(path, policy.match);
    if (!allowedActions.has(String(policy.action)))
      failures.push(`${path}: invalid action ${String(policy.action)}`);
    if (!allowedSeverities.has(String(policy.severity)))
      failures.push(`${path}: invalid severity ${String(policy.severity)}`);
    if (policy.action === "require_approval")
      validateApproval(path, policy.approval);
    else if (policy.approval !== undefined)
      failures.push(`${path}: approval is only valid with require_approval`);
  }
}

for (const [packName, manifest] of packs) {
  for (const reference of Array.isArray(manifest.extends)
    ? manifest.extends
    : []) {
    const parsed = parseExtend(String(reference));
    if (!parsed) {
      failures.push(
        `${join(root, packName, "pack.yaml")}: invalid extended pack constraint ${String(reference)}`,
      );
      continue;
    }
    const { parent, minimum } = parsed;
    if (!parent || !packs.has(parent))
      failures.push(
        `${join(root, packName, "pack.yaml")}: unknown extended pack ${String(reference)}`,
      );
    if (parent === packName)
      failures.push(
        `${join(root, packName, "pack.yaml")}: pack cannot extend itself`,
      );
    const parentVersion = packs.get(parent)?.version;
    if (
      typeof parentVersion === "string" &&
      Number(parentVersion.split(".")[0]) !== minimum[0]
    )
      failures.push(
        `${join(root, packName, "pack.yaml")}: incompatible extended pack ${String(reference)} (found ${parentVersion})`,
      );
  }
}

function parseExtend(
  reference: string,
): { parent: string; minimum: [number, number, number] } | undefined {
  const match = /^([a-z0-9][a-z0-9-]*)@\^(\d+)\.(\d+)\.(\d+)$/.exec(reference);
  return match
    ? {
        parent: match[1] as string,
        minimum: [Number(match[2]), Number(match[3]), Number(match[4])],
      }
    : undefined;
}
validateExtendsCycles();

if (count === 0) failures.push("policy-packs: no policy YAML files found");
if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Validated ${count} policies in ${packs.size} packs.\n`);
}

function validateMatch(path: string, value: unknown): void {
  if (!isRecord(value)) return;
  rejectUnknownFields(`${path}: match`, value, matchFields);
  if (
    value.direction !== undefined &&
    !allowedDirections.has(String(value.direction))
  )
    failures.push(`${path}: invalid match.direction`);
  if (
    value.tool !== undefined &&
    (typeof value.tool !== "string" || value.tool.length === 0)
  )
    failures.push(`${path}: match.tool must be a string`);
  if (value.server_trust !== undefined)
    validateServerTrust(path, value.server_trust);
  if (value.args !== undefined && !isRecord(value.args))
    failures.push(`${path}: match.args must be an object`);
  else if (isRecord(value.args)) validateArgs(path, value.args);
  if (value.detections !== undefined && !isRecord(value.detections))
    failures.push(`${path}: match.detections must be an object`);
  else if (isRecord(value.detections)) {
    rejectUnknownFields(
      `${path}: match.detections`,
      value.detections,
      detectionFields,
    );
    for (const [key, tags] of Object.entries(value.detections)) {
      // min_count is a count, not a tag list; a policy that asked for zero or a
      // fraction of a detection would match in ways nobody could reason about.
      if (key === "min_count") {
        if (typeof tags !== "number" || !Number.isInteger(tags) || tags < 1)
          failures.push(
            `${path}: match.detections.min_count must be an integer of at least 1`,
          );
        continue;
      }
      if (
        !Array.isArray(tags) ||
        tags.length === 0 ||
        !tags.every((tag) => typeof tag === "string" && tag.length > 0)
      )
        failures.push(
          `${path}: match.detections.${key} must be a non-empty string list`,
        );
    }
  }
  if (isRecord(value.risk_score)) {
    rejectUnknownFields(
      `${path}: match.risk_score`,
      value.risk_score,
      riskFields,
    );
    const { gte, lte } = value.risk_score;
    if (gte !== undefined && (!isFiniteNumber(gte) || gte < 0 || gte > 100))
      failures.push(`${path}: risk_score.gte must be 0..100`);
    if (lte !== undefined && (!isFiniteNumber(lte) || lte < 0 || lte > 100))
      failures.push(`${path}: risk_score.lte must be 0..100`);
    if (isFiniteNumber(gte) && isFiniteNumber(lte) && gte > lte)
      failures.push(`${path}: risk_score.gte must not exceed lte`);
  } else if (value.risk_score !== undefined)
    failures.push(`${path}: match.risk_score must be an object`);
}

function validateServerTrust(path: string, value: unknown): void {
  if (Array.isArray(value)) {
    if (
      value.length === 0 ||
      !value.every((entry) => allowedGrades.has(String(entry)))
    ) {
      failures.push(
        `${path}: match.server_trust list must be a non-empty list of trusted/limited/untrusted`,
      );
    } else if (new Set(value).size !== value.length) {
      failures.push(`${path}: match.server_trust list must not repeat a grade`);
    }
    return;
  }
  if (!allowedTrust.has(String(value)))
    failures.push(`${path}: invalid match.server_trust`);
}

function validateApproval(path: string, value: unknown): void {
  if (!isRecord(value)) {
    failures.push(`${path}: require_approval needs an approval block`);
    return;
  }
  rejectUnknownFields(`${path}: approval`, value, approvalFields);
  const timeout = value.timeout_seconds;
  if (!isInteger(timeout) || timeout < 1 || timeout > 3600)
    failures.push(`${path}: approval.timeout_seconds must be 1..3600`);
  if (value.on_timeout !== "block")
    failures.push(`${path}: approval.on_timeout must be block`);
  if (
    value.allow_masked_approval !== undefined &&
    typeof value.allow_masked_approval !== "boolean"
  )
    failures.push(`${path}: allow_masked_approval must be boolean`);
}

function validateArgs(path: string, args: Record<string, unknown>): void {
  for (const [condition, value] of Object.entries(args)) {
    if (condition.endsWith("_exists")) {
      if (typeof value !== "boolean")
        failures.push(`${path}: match.args.${condition} must be boolean`);
    } else if (condition.endsWith("_regex")) {
      if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.length > 512
      ) {
        failures.push(
          `${path}: match.args.${condition} must be a 1..512 character regex string`,
        );
      } else if (!isSafePolicyRegex(value))
        failures.push(
          `${path}: match.args.${condition} is not in the safe JavaScript regex subset`,
        );
    } else if (condition.endsWith("_glob")) {
      if (typeof value !== "string" || value.length === 0)
        failures.push(
          `${path}: match.args.${condition} must be a non-empty glob string`,
        );
    } else if (
      condition.endsWith("_domain") ||
      condition.endsWith("_not_domain")
    ) {
      const domains = Array.isArray(value) ? value : [value];
      if (
        domains.length === 0 ||
        !domains.every(
          (domain) =>
            typeof domain === "string" && /^[a-z0-9.-]+$/i.test(domain),
        )
      )
        failures.push(
          `${path}: match.args.${condition} must contain valid domains`,
        );
    } else if (condition.endsWith("_in") || condition.endsWith("_not_in")) {
      if (!Array.isArray(value) || value.length === 0)
        failures.push(
          `${path}: match.args.${condition} must be a non-empty list`,
        );
    } else if (typeof value === "object" && value !== null) {
      failures.push(
        `${path}: match.args.${condition} exact values must be scalar`,
      );
    }
  }
}

function validateExtendsCycles(): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (packName: string, trail: string[]): void => {
    if (visiting.has(packName)) {
      failures.push(
        `${join(root, packName, "pack.yaml")}: extends cycle ${[...trail, packName].join(" -> ")}`,
      );
      return;
    }
    if (visited.has(packName)) return;
    visiting.add(packName);
    const manifest = packs.get(packName);
    for (const reference of Array.isArray(manifest?.extends)
      ? manifest.extends
      : []) {
      const parent = String(reference).split("@")[0];
      if (parent && packs.has(parent)) visit(parent, [...trail, packName]);
    }
    visiting.delete(packName);
    visited.add(packName);
  };
  for (const packName of packs.keys()) visit(packName, []);
}

function rejectUnknownFields(
  path: string,
  value: Record<string, unknown>,
  allowed: Set<string>,
): void {
  for (const field of Object.keys(value))
    if (!allowed.has(field)) failures.push(`${path}: unknown field ${field}`);
}

function requireFields(
  path: string,
  value: Record<string, unknown>,
  fields: string[],
): void {
  for (const field of fields)
    if (value[field] === undefined) failures.push(`${path}: missing ${field}`);
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

async function readYaml(
  path: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = parse(await readFile(path, "utf8"));
    if (!isRecord(value)) {
      failures.push(`${path}: YAML document must be an object`);
      return undefined;
    }
    return value;
  } catch (error) {
    failures.push(
      `${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

async function directoryNames(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort();
}

async function policyFiles(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const child = join(path, entry.name);
      return entry.isDirectory() ? policyFiles(child) : [child];
    }),
  );
  return nested
    .flat()
    .filter((file) => [".yaml", ".yml"].includes(extname(file)))
    .sort();
}

async function isFile(path: string): Promise<boolean> {
  return stat(path)
    .then((value) => value.isFile())
    .catch(() => false);
}
