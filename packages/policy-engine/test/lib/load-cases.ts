// Fixture loader for the Policy Unit Test Framework (GMCP-16).
//
// Parses a `<policy-id>.cases.yaml` fixture (policyId + policyFile + cases[])
// and the policy YAML it points at, both with structural validation so a
// malformed fixture fails with a specific message instead of a confusing
// runtime TypeError inside the table test (task spec §9, last DoD item).

import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { Action, Policy, PolicyContext, Severity } from "../../src/types.js";
import { actions, severities } from "../../src/types.js";
import { parsePolicyFile } from "../../src/loader/parsePolicyFile.js";

export interface PolicyCase {
  name: string;
  input: PolicyContext;
  expected: {
    verdict: Action;
    matchedPolicyIds: string[];
    severity?: Severity;
  };
}

export interface CaseFile {
  policyId: string;
  policyFile: string;
  pack: string;
  cases: PolicyCase[];
}

const VALID_ACTIONS = new Set<string>(actions);
const VALID_SEVERITIES = new Set<string>(severities);

/** Loads and structurally validates a `*.cases.yaml` fixture. Throws on any schema violation. */
export function loadCaseFile(absPath: string): CaseFile {
  const raw = parseYamlObject(readFileSync(absPath, "utf8"), absPath);

  const policyId = requireString(raw, "policyId", absPath);
  const policyFile = requireString(raw, "policyFile", absPath);
  const pack = requireString(raw, "pack", absPath);

  const rawCases = raw.cases;
  if (!Array.isArray(rawCases) || rawCases.length === 0) {
    throw new Error(`${absPath}: "cases" 배열이 비어 있거나 없습니다.`);
  }

  const cases = rawCases.map((entry, index) => parseCase(entry, absPath, index));

  const hasPositiveCase = cases.some((c) => c.expected.matchedPolicyIds.includes(policyId));
  if (!hasPositiveCase) {
    throw new Error(
      `${absPath}: 최소 1개의 양성 케이스가 필요합니다 (expected.matchedPolicyIds에 "${policyId}"를 포함하는 케이스가 없습니다).`
    );
  }

  return { policyId, policyFile, pack, cases };
}

/** Loads and validates a policy YAML file via the production loader (loader/parsePolicyFile.ts). */
export function loadPolicy(absPath: string): Policy {
  const text = readFileSync(absPath, "utf8");
  const { policy, errors } = parsePolicyFile(text, absPath);
  if (!policy) {
    const details = errors.map((error) => `  - [${error.ruleId}] ${error.message}`).join("\n");
    throw new Error(`${absPath}: 정책 파일을 로드하지 못했습니다.\n${details}`);
  }
  return policy;
}

function parseCase(entry: unknown, filePath: string, index: number): PolicyCase {
  const obj = asObject(entry, `${filePath}: cases[${index}]가 올바른 객체가 아닙니다.`);
  const name = requireString(obj, "name", filePath, `cases[${index}]`);
  const input = asObject(obj.input, `${filePath}: cases[${index}] "${name}".input이 없거나 객체가 아닙니다.`) as unknown as PolicyContext;
  const expectedRaw = asObject(obj.expected, `${filePath}: cases[${index}] "${name}".expected가 없거나 객체가 아닙니다.`);

  const verdict = requireString(expectedRaw, "verdict", filePath, `cases[${index}] "${name}".expected`);
  if (!VALID_ACTIONS.has(verdict)) {
    throw new Error(
      `${filePath}: cases[${index}] "${name}".expected.verdict 값 "${verdict}"이 유효하지 않습니다. 허용값: ${[...VALID_ACTIONS].join(", ")}`
    );
  }

  const matchedPolicyIds = expectedRaw.matchedPolicyIds;
  if (!Array.isArray(matchedPolicyIds) || matchedPolicyIds.some((id) => typeof id !== "string")) {
    throw new Error(
      `${filePath}: cases[${index}] "${name}".expected.matchedPolicyIds는 문자열 배열이어야 합니다.`
    );
  }

  const severity = expectedRaw.severity;
  if (severity !== undefined && (typeof severity !== "string" || !VALID_SEVERITIES.has(severity))) {
    throw new Error(
      `${filePath}: cases[${index}] "${name}".expected.severity 값 "${String(severity)}"이 유효하지 않습니다. 허용값: ${[...VALID_SEVERITIES].join(", ")}`
    );
  }

  return {
    name,
    input,
    expected: {
      verdict: verdict as Action,
      matchedPolicyIds: matchedPolicyIds as string[],
      ...(severity !== undefined ? { severity: severity as Severity } : {})
    }
  };
}

function parseYamlObject(text: string, filePath: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (cause) {
    throw new Error(`${filePath}: YAML 파싱에 실패했습니다. ${String(cause)}`);
  }
  return asObject(parsed, `${filePath}: 최상위 값이 YAML 객체가 아닙니다.`);
}

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function requireString(obj: Record<string, unknown>, key: string, filePath: string, context?: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    const where = context ? `${context}.${key}` : key;
    throw new Error(`${filePath}: "${where}" 필드가 없거나 문자열이 아닙니다.`);
  }
  return value;
}
