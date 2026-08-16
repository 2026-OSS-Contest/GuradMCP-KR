// Policy Unit Test Framework (GMCP-16).
//
// Table-driven regression gate: every `test/fixtures/**/*.cases.yaml` pairs a
// policy YAML with a set of (input context -> expected verdict) cases. This
// calls the same production evaluation rule (evaluatePolicies, GMCP-75, 부록
// A.3 — priority-ascending, severity-max, default_action fallback) that the
// gateway's Decision Engine (decide.ts) uses, so a matcher/evaluator
// regression here is a real regression, not a divergent test double.
//
// See docs/task-docs/GMCP-16/policy-unit-test-framework.md for the spec this
// implements.

import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluatePolicies } from "../src/evaluate.js";
import type { PolicyPackConfig } from "../src/types.js";
import { loadCaseFile, loadPolicy } from "./lib/load-cases.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const caseFiles = globSync("fixtures/**/*.cases.yaml", { cwd: testDir }).sort();

if (caseFiles.length === 0) {
  throw new Error(`${path.join(testDir, "fixtures")} 아래에서 *.cases.yaml 픽스처를 찾지 못했습니다.`);
}

for (const relativeFile of caseFiles) {
  const absFile = path.join(testDir, relativeFile);
  const { policyId, policyFile, pack, cases } = loadCaseFile(absFile);
  const resolvedPolicyFile = path.resolve(path.dirname(absFile), policyFile);
  const policy = loadPolicy(resolvedPolicyFile);

  // Fail immediately at load time (task spec §4/§9): a mismatch here means
  // every case below would silently evaluate against the wrong policy id,
  // so this must not surface as just another failing `it()` assertion.
  if (policy.id !== policyId) {
    throw new Error(
      `${absFile}: fixture의 policyId("${policyId}")가 ${resolvedPolicyFile}의 id("${policy.id}")와 일치하지 않습니다.`
    );
  }

  describe(`[${pack}] ${policyId}`, () => {
    it("fixture의 policyId와 정책 YAML의 id가 일치한다", () => {
      expect(policy.id).toBe(policyId);
    });

    // Single-policy pack: isolates this policy's own match/action so a
    // fixture only ever exercises the rule it documents, never a neighbor's.
    const singlePolicyPack: PolicyPackConfig = {
      name: `${pack}:${policyId}`,
      strategy: "severity-max",
      default_action: "allow",
      rules: [policy]
    };

    it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, testCase) => {
      const result = evaluatePolicies([policy], testCase.input, singlePolicyPack);
      expect(result.action).toBe(testCase.expected.verdict);
      expect(result.matchedPolicyIds).toEqual(testCase.expected.matchedPolicyIds);
      if (testCase.expected.severity) {
        expect(result.severity).toBe(testCase.expected.severity);
      }
    });
  });
}
