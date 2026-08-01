// Unit tests for evaluatePolicies()/resolveDefaultAction() (GMCP-75,
// FR-POL-02, 부록 A.3). See docs/task-docs/GMCP-75/정책평가전략구현.md §6 for
// the test plan this file follows row-by-row.

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { evaluatePolicies, resolveDefaultAction } from "../src/evaluate.js";
import type { Action, EvaluationStrategy, Policy, PolicyContext, PolicyPackConfig } from "../src/index.js";

function context(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    direction: "request",
    tool: "read_file",
    serverTrust: "untrusted",
    args: {},
    detections: [],
    riskScore: 0,
    ...overrides
  };
}

function pack(overrides: Partial<PolicyPackConfig> = {}): PolicyPackConfig {
  return { name: "test-pack", strategy: "severity-max", rules: [], ...overrides };
}

// match: {} matches unconditionally (every axis is AND-combined and an
// absent condition always passes; see matcher.ts).
function policy(overrides: Partial<Policy> & Pick<Policy, "id" | "priority" | "action">): Policy {
  return { pack: "test", match: {}, severity: "medium", ...overrides };
}

// --- 규칙 1: priority 오름차순 평가 ------------------------------------------

it("evaluates in priority-ascending order regardless of input array order", () => {
  const result = evaluatePolicies(
    [
      policy({ id: "high_priority_second", priority: 200, action: "warn" }),
      policy({ id: "low_priority_first", priority: 10, action: "block" })
    ],
    context(),
    pack({ strategy: "first-match" })
  );
  // first-match makes the winner a direct probe of evaluation order.
  expect(result.winningPolicyId).toBe("low_priority_first");
  expect(result.action).toBe("block");
});

// --- 규칙 2: severity-max ----------------------------------------------------

it("adopts the strongest action among every matched policy under severity-max", () => {
  const rules = [
    policy({ id: "p_allow", priority: 10, action: "allow" }),
    policy({ id: "p_mask", priority: 20, action: "mask_then_allow" }),
    policy({ id: "p_warn", priority: 30, action: "warn" }),
    policy({ id: "p_approve", priority: 40, action: "require_approval" }),
    policy({ id: "p_block", priority: 50, action: "block", severity: "critical" })
  ];
  const result = evaluatePolicies(rules, context(), pack());
  expect(result.action).toBe("block");
  expect(result.winningPolicyId).toBe("p_block");
  expect(result.severity).toBe("critical");
});

it("tie-breaks equal-rank matches toward the lower-priority policy", () => {
  const rules = [
    policy({ id: "warn_later", priority: 20, action: "warn" }),
    policy({ id: "warn_earlier", priority: 10, action: "warn" })
  ];
  const result = evaluatePolicies(rules, context(), pack());
  expect(result.winningPolicyId).toBe("warn_earlier");
});

// --- 규칙 3: default_action ---------------------------------------------------

describe("no policy matches -> default_action", () => {
  it("falls back to allow when default_action/strict are both unset", () => {
    const result = evaluatePolicies([], context(), pack());
    expect(result.action).toBe("allow");
    expect(result.usedDefault).toBe(true);
    expect(result.severity).toBeNull();
    expect(result.winningPolicyId).toBeNull();
    expect(result.matchedPolicyIds).toEqual([]);
  });

  it("falls back to warn under strict mode when default_action is unset", () => {
    const result = evaluatePolicies([], context(), pack({ strict: true }));
    expect(result.action).toBe("warn");
  });

  it("honors an explicit default_action over strict mode", () => {
    const result = evaluatePolicies([], context(), pack({ strict: true, default_action: "block" }));
    expect(result.action).toBe("block");
  });
});

describe("resolveDefaultAction", () => {
  it("prefers the explicit value, then strict, then the hardcoded allow default", () => {
    expect(resolveDefaultAction(pack())).toBe("allow");
    expect(resolveDefaultAction(pack({ strict: true }))).toBe("warn");
    expect(resolveDefaultAction(pack({ strict: true, default_action: "warn" }))).toBe("warn");
    expect(resolveDefaultAction(pack({ default_action: "block" }))).toBe("block");
  });
});

// --- 규칙 4: mask_then_allow ---------------------------------------------------

it("routes mask_then_allow as the verdict when it is the strongest match", () => {
  const rules = [
    policy({ id: "mask_pii", priority: 10, action: "mask_then_allow" }),
    policy({ id: "allow_rest", priority: 20, action: "allow" })
  ];
  const result = evaluatePolicies(rules, context(), pack());
  expect(result.action).toBe("mask_then_allow");
  expect(result.winningPolicyId).toBe("mask_pii");
});

// --- 규칙 5: matchedPolicyIds 전체 기록 -----------------------------------------

it("records every matched policy id, in priority order, under severity-max", () => {
  const rules = [
    policy({ id: "p3", priority: 30, action: "warn" }),
    policy({ id: "p1", priority: 10, action: "allow" }),
    policy({ id: "p2", priority: 20, action: "block" })
  ];
  const result = evaluatePolicies(rules, context(), pack());
  expect(result.matchedPolicyIds).toEqual(["p1", "p2", "p3"]);
  expect(result.winningPolicyId).toBe("p2");
});

it("still records matches after the winner under first-match", () => {
  const rules = [
    policy({ id: "p1", priority: 10, action: "allow" }),
    policy({ id: "p2", priority: 20, action: "block" }),
    policy({ id: "p3", priority: 30, action: "warn" })
  ];
  const result = evaluatePolicies(rules, context(), pack({ strategy: "first-match" }));
  expect(result.winningPolicyId).toBe("p1");
  expect(result.action).toBe("allow");
  expect(result.matchedPolicyIds).toEqual(["p1", "p2", "p3"]);
});

// --- 전략 전환: 팩 설정만으로 severity-max <-> first-match ------------------------

it("switches the outcome purely via pack.strategy, with no code change", () => {
  const rules = [
    policy({ id: "p1", priority: 10, action: "warn" }),
    policy({ id: "p2", priority: 20, action: "block" })
  ];
  expect(evaluatePolicies(rules, context(), pack({ strategy: "severity-max" })).action).toBe("block");
  expect(evaluatePolicies(rules, context(), pack({ strategy: "first-match" })).action).toBe("warn");
});

// --- AC5: match.ts와의 통합 테스트 (정책팩 실제 YAML 로드 → 평가) -------------------

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

interface PackManifest {
  name: string;
  default_action: Action;
  evaluation_strategy: EvaluationStrategy;
  policies: string[];
}

async function loadPack(name: string): Promise<{ config: PolicyPackConfig; rules: Policy[] }> {
  const packRoot = join(repoRoot, "policy-packs", name);
  const manifest = parse(await readFile(join(packRoot, "pack.yaml"), "utf8")) as PackManifest;
  const rules = await Promise.all(
    manifest.policies.map(async (relativePath) => parse(await readFile(join(packRoot, relativePath), "utf8")) as Policy)
  );
  return {
    rules,
    config: { name: manifest.name, strategy: manifest.evaluation_strategy, default_action: manifest.default_action, rules }
  };
}

it("evaluates the real 'default' policy pack loaded from YAML via matcher.ts", async () => {
  const { config, rules } = await loadPack("default");
  const result = evaluatePolicies(
    rules,
    context({ direction: "request", tool: "read_file", args: { path: "/app/.env" } }),
    config
  );
  expect(result.action).toBe("block");
  expect(result.winningPolicyId).toBe("block_env_file_read");
  expect(result.matchedPolicyIds).toEqual(["block_env_file_read"]);
});
