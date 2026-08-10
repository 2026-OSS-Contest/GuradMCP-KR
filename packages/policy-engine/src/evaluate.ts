// Policy evaluation strategies (GMCP-75, FR-POL-02, 부록 A.3).
//
// evaluatePolicies() sorts active policies by priority ascending (규칙 1) and
// adopts a single action under one of two pack-level strategies:
//   - severity-max (default, 규칙 2): the strongest ACTION_RANK among every
//     matched policy wins. Ties on action strength go to the higher
//     SEVERITY_RANK (critical > ... > info); remaining ties go to the
//     lower-priority (earlier-evaluated) policy, since `matched` is already
//     priority/id sorted.
//   - first-match: the first matched policy's action wins immediately, but
//     evaluation continues over the rest so `matchedPolicyIds` still records
//     every match that follows it — 규칙 5 (전체 매칭 ID 기록) has no
//     first-match exception, only action adoption short-circuits.
//
// No policy matching -> the pack's default_action (규칙 3, resolveDefaultAction).
// mask_then_allow participates in ranking like any other action (규칙 4);
// the actual payload masking happens downstream (action router), not here.
//
// See docs/task-docs/GMCP-75/정책평가전략구현.md §3-§4 for the rules this
// mirrors. Matching itself (A.1/A.2) is unchanged; this module only decides
// among policies that `matchesPolicy` already says matched.

import type { Action, EvaluationResult, Policy, PolicyContext, PolicyPackConfig } from "./types.js";
import { matchesPolicy } from "./matcher.js";
import { ACTION_RANK, SEVERITY_RANK } from "./action-rank.js";

export function evaluatePolicies(
  rules: Policy[],
  context: PolicyContext,
  pack: PolicyPackConfig
): EvaluationResult {
  const sorted = [...rules]
    .filter((rule) => rule.enabled !== false)
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));

  const matched: Policy[] = [];
  let firstMatchWinner: Policy | null = null;

  for (const rule of sorted) {
    if (!matchesPolicy(rule, context)) continue;
    matched.push(rule);
    if (pack.strategy === "first-match" && firstMatchWinner === null) {
      firstMatchWinner = rule;
    }
  }

  if (matched.length === 0) {
    return {
      action: resolveDefaultAction(pack),
      severity: null,
      matchedPolicyIds: [],
      winningPolicyId: null,
      strategy: pack.strategy,
      usedDefault: true
    };
  }

  const winner =
    firstMatchWinner ??
    matched.reduce((strongest, rule) => {
      const ruleRank = ACTION_RANK[rule.action];
      const strongestRank = ACTION_RANK[strongest.action];
      if (ruleRank !== strongestRank) return ruleRank > strongestRank ? rule : strongest;
      // Remaining tie stays with `strongest`: priority/id order via sort above.
      return SEVERITY_RANK[rule.severity] > SEVERITY_RANK[strongest.severity] ? rule : strongest;
    });

  return buildResult(winner, matched, pack);
}

/** 규칙 3: 명시된 default_action > strict 모드(warn) > 하드코딩 기본값(allow). */
export function resolveDefaultAction(pack: PolicyPackConfig): Action {
  if (pack.default_action !== undefined) return pack.default_action;
  return pack.strict ? "warn" : "allow";
}

function buildResult(winner: Policy, matched: Policy[], pack: PolicyPackConfig): EvaluationResult {
  return {
    action: winner.action,
    severity: winner.severity,
    matchedPolicyIds: matched.map((rule) => rule.id),
    winningPolicyId: winner.id,
    strategy: pack.strategy,
    usedDefault: false
  };
}
