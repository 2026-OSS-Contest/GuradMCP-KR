// Decision Engine (GMCP-12, FR-POL-02).
//
// decide() is pipeline stage ⑥: it takes the Risk Scorer's output (stage ⑤)
// and the already loaded/activated policy list, evaluates them, and returns
// a single verdict plus the full list of matched policy IDs. It is a pure
// function — no masking, no approval-queue writes; those are stage ⑦'s
// responsibility (spec §6).
//
// As of GMCP-75 this is a thin adapter over `evaluatePolicies()`
// (evaluate.ts), which owns the actual priority/strategy/default_action
// algorithm (부록 A.3). This module just translates the DecisionInput/
// DecisionResult shapes GMCP-12 already exposes to the rest of the gateway.

import type { DecisionInput, DecisionResult, PolicyContext, PolicyPackConfig } from "./types.js";
import { evaluatePolicies } from "./evaluate.js";

export function decide(input: DecisionInput): DecisionResult {
  const context: PolicyContext = {
    direction: input.event.direction,
    tool: input.event.toolName,
    serverTrust: input.event.serverTrust,
    args: input.event.args,
    detections: input.detections,
    riskScore: input.riskScore
  };

  const pack: PolicyPackConfig = {
    name: "decide-adapter",
    strategy: input.strategy ?? "severity-max",
    default_action: input.defaultAction,
    strict: input.strictMode,
    rules: input.activePolicies
  };

  const result = evaluatePolicies(input.activePolicies, context, pack);

  if (result.usedDefault) {
    return {
      verdict: result.action,
      matchedPolicyIds: [],
      decidingPolicyId: null,
      reason:
        input.strictMode && input.defaultAction === undefined
          ? "strict 모드: 매칭 정책 없음 → warn"
          : `매칭 정책 없음 → default_action(${result.action})`
    };
  }

  const deciding = input.activePolicies.find((policy) => policy.id === result.winningPolicyId);
  return {
    verdict: result.action,
    matchedPolicyIds: result.matchedPolicyIds,
    decidingPolicyId: result.winningPolicyId,
    reason: deciding?.message ?? `정책 ${result.winningPolicyId} 매칭`
  };
}
