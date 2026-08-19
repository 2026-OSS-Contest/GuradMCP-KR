// Shadow/actionable policy partitioning (SPEC-POL-04 §3.2, GMCP-77).
//
// One helper module shared by both live evaluators — `evaluatePolicies()` (evaluate.ts, the
// GMCP-75/GMCP-12 canonical path used by `decide()` and the attack-lab runner/benchmark) and
// `evaluate()` (index.ts, the GMCP-7 wrapper the live gateway actually calls from
// `server.ts`'s `evaluatePayloadOrThrow`) — so the zero-side-effect guarantee (§2.1) and the
// severity-max/wouldEscalate arithmetic (§3.2 규칙4/5) are implemented exactly once rather than
// twice in slightly different ways.

import type { Action, EvaluationMode, Policy, VirtualVerdict } from "./types.js";
import { ACTION_RANK, SEVERITY_RANK } from "./action-rank.js";

/**
 * §3.2 규칙2: split an already-matched, priority-sorted policy list into the group that decides
 * the real action (`actionable`) and the group that only ever produces a virtual verdict
 * (`shadow`). `mode: "shadow-all"` (§7.1, Benchmark Runner only) forces every match into
 * `shadow` regardless of its own `dry_run` value — used to observe a whole pack as if none of
 * it could act, without touching any policy file.
 */
export function splitShadow(
  matched: Policy[],
  mode: EvaluationMode = "normal"
): { actionable: Policy[]; shadow: Policy[] } {
  if (mode === "shadow-all") return { actionable: [], shadow: matched };
  return {
    actionable: matched.filter((policy) => policy.dry_run !== true),
    shadow: matched.filter((policy) => policy.dry_run === true)
  };
}

/**
 * §3.2 규칙4: severity-max within the shadow group alone, independent of whatever the
 * actionable group decided. `null` when nothing shadow-matched — never synthesized from the
 * actionable side.
 */
export function severityMaxVirtualVerdict(shadow: Policy[]): VirtualVerdict | null {
  if (shadow.length === 0) return null;
  const winner = shadow.reduce((strongest, policy) => {
    const rank = ACTION_RANK[policy.action];
    const strongestRank = ACTION_RANK[strongest.action];
    if (rank !== strongestRank) return rank > strongestRank ? policy : strongest;
    // Tie stays with `strongest`: `shadow` is already priority/id sorted (it is a filtered
    // view of the caller's priority-sorted `matched` array), so this mirrors evaluate.ts's
    // own severity-max tie-break exactly.
    return SEVERITY_RANK[policy.severity] > SEVERITY_RANK[strongest.severity] ? policy : strongest;
  });
  return { action: winner.action, severity: winner.severity };
}

/** §3.2 규칙5: the shadow verdict is strictly stronger than the real one. */
export function computeWouldEscalate(actual: Action, virtual: VirtualVerdict | null): boolean {
  return virtual !== null && ACTION_RANK[virtual.action] > ACTION_RANK[actual];
}
