// Validates the Attack Lab scenario catalog (GMCP-62).
//
// The catalog is the definition; `threats.json` holds the executable probes and
// `docs/attack-scenarios*.md` is the human-readable index. This script is what
// makes the three stay 1:1 — a probe nobody claims, a scenario nobody documents,
// or an expected detection the detector no longer produces all fail here rather
// than drifting quietly.
import { readFile } from "node:fs/promises";
import { detect } from "../packages/gateway/src/detect.js";
import { runtimePolicyPacks } from "../packages/gateway/src/policies.generated.js";

const catalogPath = "attack-lab/scenarios/catalog.json";
const probePath = "attack-lab/scenarios/threats.json";
const documentPaths = ["docs/attack-scenarios.md", "docs/attack-scenarios.en.md"];

/** OWASP LLM Top 10 (2025) identifiers; the catalog may only cite these. */
const owaspIds = new Set(["LLM01", "LLM02", "LLM03", "LLM04", "LLM05", "LLM06", "LLM07", "LLM08", "LLM09", "LLM10"]);
const stages = new Set(["normalizer", "secret-detector", "pii-detector", "injection-detector", "tool-metadata", "risk-scorer", "policy-engine"]);
const verdicts = new Set(["allow", "warn", "mask_then_allow", "require_approval", "block"]);
const directions = new Set(["request", "response"]);
const trustLevels = new Set(["trusted", "limited", "untrusted"]);
const kinds = new Set(["attack", "benign"]);
const threatFields = new Set(["id", "name", "summary", "owasp"]);
const scenarioFields = new Set(["id", "threat", "kind", "title", "premise", "vector", "expectedControl", "pass", "fail", "automation"]);
const controlFields = new Set(["stage", "context", "detections", "policy", "verdict"]);
const contextFields = new Set(["direction", "tool", "serverTrust"]);
const probeAutomationFields = new Set(["mode", "probes"]);
const manualAutomationFields = new Set(["mode", "reason", "blockedBy"]);

interface Probe { id: string; text: string; expectBlocked: boolean }

const failures: string[] = [];
const policyIds = new Set(Object.values(runtimePolicyPacks).flatMap(({ policies }) => policies.map(({ id }) => id)));

const catalog = await readJson(catalogPath);
const probes = await readProbes(probePath);
const documents = await Promise.all(documentPaths.map(async (path) => ({ path, text: await readText(path) })));

if (catalog) {
  rejectUnknownFields(catalogPath, catalog, new Set(["version", "threats", "scenarios"]));
  if (catalog.version !== 1) failures.push(`${catalogPath}: version must be 1`);
  const threats = validateThreats(catalog.threats);
  const scenarios = validateScenarios(catalog.scenarios, threats);
  checkThreatCoverage(threats, scenarios);
  checkProbeCorrespondence(scenarios);
  checkDocumentCorrespondence(scenarios);
}

if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  const counts = countScenarios(catalog);
  process.stdout.write(`${catalogPath}: ${counts.attack} attack and ${counts.benign} benign scenarios cover ${counts.probes} probes.\n`);
}

/** Returns the declared threat ids, reporting every structural problem it finds. */
function validateThreats(value: unknown): Map<string, Record<string, unknown>> {
  const threats = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(value) || value.length === 0) {
    failures.push(`${catalogPath}: threats must be a non-empty list`);
    return threats;
  }
  for (const [index, entry] of value.entries()) {
    const label = `${catalogPath}: threats[${index}]`;
    if (!isRecord(entry)) {
      failures.push(`${label} must be an object`);
      continue;
    }
    rejectUnknownFields(label, entry, threatFields);
    const id = entry.id;
    if (typeof id !== "string" || !/^T-\d{2}$/.test(id)) {
      failures.push(`${label}: id must look like T-01`);
      continue;
    }
    if (threats.has(id)) failures.push(`${label}: duplicate threat id ${id}`);
    requireProse(label, entry, ["name", "summary"]);
    // The catalog's whole reason to exist is the mapping, so an unmapped threat
    // is a hard failure rather than a missing optional field.
    if (!Array.isArray(entry.owasp) || entry.owasp.length === 0) {
      failures.push(`${label}: owasp must list at least one OWASP LLM Top 10 id`);
    } else {
      for (const reference of entry.owasp) {
        if (typeof reference !== "string" || !owaspIds.has(reference)) failures.push(`${label}: unknown OWASP id ${String(reference)}`);
      }
    }
    threats.set(id, entry);
  }
  return threats;
}

function validateScenarios(value: unknown, threats: Map<string, Record<string, unknown>>): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) {
    failures.push(`${catalogPath}: scenarios must be a non-empty list`);
    return [];
  }
  const seen = new Set<string>();
  const scenarios: Record<string, unknown>[] = [];
  for (const [index, entry] of value.entries()) {
    const label = `${catalogPath}: scenarios[${index}]`;
    if (!isRecord(entry)) {
      failures.push(`${label} must be an object`);
      continue;
    }
    rejectUnknownFields(label, entry, scenarioFields);
    const id = entry.id;
    if (typeof id !== "string" || !/^[AN]-\d{2}$/.test(id)) {
      failures.push(`${label}: id must look like A-01 or N-01`);
      continue;
    }
    if (seen.has(id)) failures.push(`${label}: duplicate scenario id ${id}`);
    seen.add(id);
    const scope = `${catalogPath}: ${id}`;
    if (typeof entry.kind !== "string" || !kinds.has(entry.kind)) failures.push(`${scope}: kind must be attack or benign`);
    // An attack has to name the threat it derives from; only a benign control
    // may stand outside the catalog, because it exists to measure false positives.
    if (entry.threat === null) {
      if (entry.kind === "attack") failures.push(`${scope}: an attack scenario must reference a threat`);
    } else if (typeof entry.threat !== "string" || !threats.has(entry.threat)) {
      failures.push(`${scope}: threat must reference a declared threat id`);
    }
    requireProse(scope, entry, ["title", "premise", "vector", "pass", "fail"]);
    validateExpectedControl(scope, entry.expectedControl);
    validateAutomation(scope, entry.automation);
    scenarios.push(entry);
  }
  return scenarios;
}

function validateExpectedControl(scope: string, value: unknown): void {
  if (!isRecord(value)) {
    failures.push(`${scope}: expectedControl must be an object`);
    return;
  }
  rejectUnknownFields(scope, value, controlFields);
  if (typeof value.stage !== "string" || !stages.has(value.stage)) failures.push(`${scope}: expectedControl.stage must be a pipeline stage`);
  if (typeof value.verdict !== "string" || !verdicts.has(value.verdict)) failures.push(`${scope}: expectedControl.verdict must be a policy action`);
  // `null` says "no shipped policy owns this yet"; a string must resolve, so the
  // catalog can never cite a policy the runtime bundle does not carry.
  if (value.policy !== null && (typeof value.policy !== "string" || !policyIds.has(value.policy))) {
    failures.push(`${scope}: expectedControl.policy must be null or a shipped policy id`);
  }
  if (!Array.isArray(value.detections) || value.detections.some((tag) => typeof tag !== "string" || !/^[A-Z]+\.[A-Z_]+$/.test(tag))) {
    failures.push(`${scope}: expectedControl.detections must be TYPE.SUBTYPE tags`);
  }
  const context = value.context;
  if (!isRecord(context)) {
    failures.push(`${scope}: expectedControl.context must be an object`);
    return;
  }
  rejectUnknownFields(scope, context, contextFields);
  if (typeof context.direction !== "string" || !directions.has(context.direction)) failures.push(`${scope}: expectedControl.context.direction must be request or response`);
  if (typeof context.tool !== "string" || context.tool.length === 0) failures.push(`${scope}: expectedControl.context.tool must be a non-empty string`);
  if (typeof context.serverTrust !== "string" || !trustLevels.has(context.serverTrust)) failures.push(`${scope}: expectedControl.context.serverTrust must be a trust level`);
}

function validateAutomation(scope: string, value: unknown): void {
  if (!isRecord(value)) {
    failures.push(`${scope}: automation must be an object`);
    return;
  }
  if (value.mode === "probe") {
    rejectUnknownFields(scope, value, probeAutomationFields);
    if (!Array.isArray(value.probes) || value.probes.length === 0 || value.probes.some((probe) => typeof probe !== "string")) {
      failures.push(`${scope}: automation.probes must be a non-empty string list`);
    }
    return;
  }
  if (value.mode === "manual") {
    rejectUnknownFields(scope, value, manualAutomationFields);
    // A scenario nobody can run yet is allowed, but only when it says why and
    // names the ticket that will make it executable (AGENTS.md: no unimplemented claims).
    requireProse(scope, value, ["reason"]);
    if (typeof value.blockedBy !== "string" || !/^GMCP-\d+$/.test(value.blockedBy)) failures.push(`${scope}: automation.blockedBy must name the blocking ticket`);
    return;
  }
  failures.push(`${scope}: automation.mode must be probe or manual`);
}

function checkThreatCoverage(threats: Map<string, Record<string, unknown>>, scenarios: Record<string, unknown>[]): void {
  const covered = new Set(scenarios.filter(({ kind }) => kind === "attack").map(({ threat }) => threat));
  for (const id of threats.keys()) {
    if (!covered.has(id)) failures.push(`${catalogPath}: threat ${id} has no attack scenario`);
  }
}

/** The 1:1 rule: every probe is claimed once, and every claim resolves. */
function checkProbeCorrespondence(scenarios: Record<string, unknown>[]): void {
  if (!probes) return;
  const byId = new Map(probes.map((probe) => [probe.id, probe]));
  const claimedBy = new Map<string, string>();
  for (const scenario of scenarios) {
    const automation = scenario.automation;
    if (!isRecord(automation) || automation.mode !== "probe" || !Array.isArray(automation.probes)) continue;
    const scope = `${catalogPath}: ${String(scenario.id)}`;
    /** Union of what the detector reports across this scenario's probes. */
    const reachable = new Set<string>();
    for (const reference of automation.probes) {
      const probeId = String(reference);
      const probe = byId.get(probeId);
      if (!probe) {
        failures.push(`${scope}: probe ${probeId} is not in ${probePath}`);
        continue;
      }
      const owner = claimedBy.get(probeId);
      if (owner) failures.push(`${scope}: probe ${probeId} is already claimed by ${owner}`);
      else claimedBy.set(probeId, String(scenario.id));
      if (probe.expectBlocked !== (scenario.kind === "attack")) {
        failures.push(`${scope}: probe ${probeId} expectBlocked=${probe.expectBlocked} disagrees with kind ${String(scenario.kind)}`);
      }
      for (const tag of checkProbeDetections(scope, probe, scenario)) reachable.add(tag);
    }
    checkDeclaredTagsAreReachable(scope, scenario, reachable);
  }
  for (const probe of probes) {
    if (!claimedBy.has(probe.id)) failures.push(`${probePath}: probe ${probe.id} is not claimed by any scenario in ${catalogPath}`);
  }
}

/**
 * Half of the detection check: every probe must produce at least one declared
 * tag, so a probe cannot drift away from the scenario that claims it. Returns
 * what the detector actually reported, which the caller accumulates for the
 * other half in [checkDeclaredTagsAreReachable].
 */
function checkProbeDetections(scope: string, probe: Probe, scenario: Record<string, unknown>): Set<string> {
  const actual = new Set(detect(probe.text).map(({ type, subtype }) => `${type}.${subtype}`));
  const control = scenario.expectedControl;
  if (!isRecord(control) || !Array.isArray(control.detections)) return actual;
  const declared = control.detections.map((tag) => String(tag));
  if (declared.length === 0) {
    if (actual.size > 0) failures.push(`${scope}: probe ${probe.id} declares no detections but the detector reports ${[...actual].sort().join(", ")}`);
    return actual;
  }
  if (!declared.some((tag) => actual.has(tag))) {
    failures.push(`${scope}: probe ${probe.id} produces ${[...actual].sort().join(", ") || "no detections"}, none of which is declared`);
  }
  return actual;
}

/**
 * The other half: a declared tag no claimed probe can produce is dead weight
 * that outlives the rule it named. Checking only the per-probe direction lets a
 * renamed or deleted detector subtype sit in the catalog forever, described as
 * the expected control point for something that can no longer happen.
 */
function checkDeclaredTagsAreReachable(scope: string, scenario: Record<string, unknown>, reachable: Set<string>): void {
  const control = scenario.expectedControl;
  if (!isRecord(control) || !Array.isArray(control.detections)) return;
  for (const tag of control.detections.map((value) => String(value))) {
    if (!reachable.has(tag)) failures.push(`${scope}: declares ${tag}, which no claimed probe produces`);
  }
}

function checkDocumentCorrespondence(scenarios: Record<string, unknown>[]): void {
  for (const { path, text } of documents) {
    if (text === undefined) continue;
    for (const scenario of scenarios) {
      const id = String(scenario.id);
      // Whole-token, not substring: a document that only mentions A-011 must not
      // count as documenting A-01. Ids are validated against /^[AN]-\d{2}$/ above,
      // so they carry nothing that needs escaping here.
      if (!new RegExp(`(^|[^A-Za-z0-9-])${id}([^0-9]|$)`).test(text)) {
        failures.push(`${path}: scenario ${id} is not documented`);
      }
    }
  }
}

function countScenarios(value: Record<string, unknown> | undefined): { attack: number; benign: number; probes: number } {
  const scenarios = Array.isArray(value?.scenarios) ? value.scenarios.filter(isRecord) : [];
  const probeCount = scenarios.reduce((total, scenario) => {
    const automation = scenario.automation;
    return total + (isRecord(automation) && Array.isArray(automation.probes) ? automation.probes.length : 0);
  }, 0);
  return {
    attack: scenarios.filter(({ kind }) => kind === "attack").length,
    benign: scenarios.filter(({ kind }) => kind === "benign").length,
    probes: probeCount
  };
}

function requireProse(scope: string, value: Record<string, unknown>, fields: string[]): void {
  for (const field of fields) {
    if (typeof value[field] !== "string" || (value[field] as string).trim().length === 0) failures.push(`${scope}: ${field} must be a non-empty string`);
  }
}

function rejectUnknownFields(scope: string, value: Record<string, unknown>, allowed: Set<string>): void {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) failures.push(`${scope}: unknown field ${field}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  const text = await readText(path);
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) {
      failures.push(`${path}: document must be a JSON object`);
      return undefined;
    }
    return value;
  } catch (error) {
    failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function readProbes(path: string): Promise<Probe[] | undefined> {
  const text = await readText(path);
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) {
      failures.push(`${path}: document must be a JSON array`);
      return undefined;
    }
    const parsed: Probe[] = [];
    for (const [index, entry] of value.entries()) {
      if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.text !== "string" || typeof entry.expectBlocked !== "boolean") {
        failures.push(`${path}: [${index}] must declare id, text, and expectBlocked`);
        continue;
      }
      parsed.push({ id: entry.id, text: entry.text, expectBlocked: entry.expectBlocked });
    }
    return parsed;
  } catch (error) {
    failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function readText(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch(() => {
    failures.push(`${path}: file is missing`);
    return undefined;
  });
}
