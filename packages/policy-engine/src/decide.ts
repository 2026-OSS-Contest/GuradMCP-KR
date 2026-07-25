// Decision Engine (GMCP-12, FR-POL-02).
//
// decide() is pipeline stage ⑥: it takes the Risk Scorer's output (stage ⑤)
// and the already loaded/activated policy list, evaluates them in priority
// order, and returns a single verdict plus the full list of matched policy
// IDs. It is a pure function — no masking, no approval-queue writes; those
// are stage ⑦'s responsibility (spec §6).
//
// See docs/task-docs/GMCP-12/decision-engine.md §5 for the algorithm this
// mirrors line-for-line, and §6 for the matchedPolicyIds/first-match/
// tie-break rules encoded below.

import type { Action, DecisionInput, DecisionResult, Policy, PolicyContext } from "./types.js";
import { matchesPolicy } from "./matcher.js";

const ACTION_RANK: Record<Action, number> = {
  block: 4,
  require_approval: 3,
  warn: 2,
  mask_then_allow: 1,
  allow: 0
};

export function decide(input: DecisionInput): DecisionResult {
  const strategy = input.strategy ?? "severity-max";
  const sorted = [...input.activePolicies]
    .filter((policy) => policy.enabled !== false)
    .sort((left, right) => left.priority - right.priority);

  const context: PolicyContext = {
    direction: input.event.direction,
    tool: input.event.toolName,
    serverTrust: input.event.serverTrust,
    args: input.event.args,
    detections: input.detections,
    riskScore: input.riskScore
  };

  const matched: Policy[] = [];
  for (const policy of sorted) {
    if (!matchesPolicy(policy, context)) continue;
    matched.push(policy);
    // first-match stops evaluating further policies entirely, so anything
    // after the break point is never considered "matched" (spec §6).
    if (strategy === "first-match") break;
  }

  if (matched.length === 0) {
    const verdict: Action = input.strictMode ? "warn" : input.defaultAction ?? "allow";
    return {
      verdict,
      matchedPolicyIds: [],
      decidingPolicyId: null,
      reason: input.strictMode
        ? "strict 모드: 매칭 정책 없음 → warn"
        : `매칭 정책 없음 → default_action(${verdict})`
    };
  }

  // For first-match, `matched` always has exactly one element, so this
  // trivially picks it. For severity-max, strict `>` means the first policy
  // (priority-ascending) to reach a given rank keeps it — the tie-break
  // rule from spec §6.
  const deciding = matched.reduce((strongest, policy) =>
    ACTION_RANK[policy.action] > ACTION_RANK[strongest.action] ? policy : strongest
  );

  return {
    verdict: deciding.action,
    matchedPolicyIds: matched.map((policy) => policy.id),
    decidingPolicyId: deciding.id,
    reason: deciding.message ?? `정책 ${deciding.id} 매칭`
  };
}
