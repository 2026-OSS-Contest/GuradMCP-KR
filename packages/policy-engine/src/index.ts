// Public entry point for @guardmcp/policy-engine.
//
// Types live in ./types.ts (GMCP-7 DoD) and match evaluation in ./matcher.ts
// (GMCP-7, FR-POL-01). This module re-exports both and adds the pipeline
// wrapper `evaluate` (priority sort + strategy adoption, FR-POL-02).

export type {
  Action,
  Severity,
  Direction,
  ServerTrust,
  EvaluationStrategy,
  EvaluationMode,
  DetectionType,
  Detection,
  PolicyContext,
  ToolCallContext,
  MatchDefinition,
  PolicyMatch,
  Policy,
  VirtualVerdict,
  MatchEvaluation,
  PolicyPackConfig,
  EvaluationResult,
  DecisionEvent,
  DecisionInput,
  DecisionResult,
  ReasonCode,
} from "./types.js";
export { actions, severities, reasonCodes } from "./types.js";
export { splitShadow, severityMaxVirtualVerdict, computeWouldEscalate } from "./shadow.js";

export {
  matchesPolicy,
  matches,
  matchDirection,
  matchTool,
  matchServerTrust,
  matchRiskScore,
  matchDetections,
  matchArgs,
  isSafePolicyRegex,
} from "./matcher.js";

export { decide } from "./decide.js";
export { evaluatePolicies, resolveDefaultAction } from "./evaluate.js";
export { ACTION_RANK } from "./action-rank.js";

export type { PolicyLoadError, PolicyLoadErrorLevel } from "./loader/errors.js";
export {
  parsePolicyFile,
  type ParsePolicyFileResult,
} from "./loader/parsePolicyFile.js";
export {
  parseYamlWithSchema,
  type YamlValidationResult,
} from "./loader/parseYaml.js";
export {
  packManifestSchema,
  policyFileSchema,
  type PackManifestInput,
  type PolicyFileInput,
} from "./loader/policySchema.js";
export {
  scanPackDirectories,
  findManifestPath,
  listYamlFilesFlat,
  type PackDirectoryEntry,
} from "./loader/scanPackDirectory.js";
export {
  PackRegistry,
  loadPolicyPacks,
  type PackState,
  type PackSummary,
  type PolicySource,
  type LoadPolicyPacksOptions,
} from "./loader/packRegistry.js";
export type { PathNormalizationResult } from "./pathNormalize.js";
export {
  PATH_LIKE_KEYS,
  normalizePath,
  extractPathArg,
  basename as pathBasename,
} from "./pathNormalize.js";

import type {
  Action,
  EvaluationMode,
  MatchEvaluation,
  EvaluationStrategy,
  Policy,
  PolicyContext,
} from "./types.js";
import { matchesPolicy } from "./matcher.js";
import { computeWouldEscalate, severityMaxVirtualVerdict, splitShadow } from "./shadow.js";
import { ACTION_RANK } from "./action-rank.js";

/**
 * SPEC-POL-04 §3.2/§5.1 (GMCP-77): this is the function `packages/gateway/src/server.ts`'s
 * `evaluatePayloadOrThrow` actually calls for every live Tool Call — not `evaluatePolicies()`
 * (evaluate.ts), which only the GMCP-12 `decide()` adapter (attack-lab runner/benchmark) uses.
 * The shadow/actionable split has to live here too, or dry-run policies would only be inert on
 * the benchmark's evaluation path and would actually fire in production.
 *
 * `matched`/`policies`/`matchedPolicyIds` stay ACTIONABLE-only (§2.1's zero-side-effect
 * guarantee, §4.1's `GuardEvent.matchedPolicyIds` contract): `server.ts`'s `toPolicyDecision`
 * picks its "deciding policy" — the source of the block error's severity/message/reasonCode —
 * by reducing over `result.policies`, so a shadow policy leaking into that list would let a
 * dry-run `block` policy's message reach a real block response even while `action` itself
 * stayed correct. `dryRunAction`/`dryRunMatchedPolicyIds`/`wouldEscalate` carry the shadow
 * group's own verdict alongside, never blended into the fields above.
 */
export function evaluate(
  policies: Policy[],
  context: PolicyContext,
  defaultAction: Action = "allow",
  strategy: EvaluationStrategy = "severity-max",
  mode: EvaluationMode = "normal",
): MatchEvaluation {
  const sorted = [...policies]
    .filter((policy) => policy.enabled !== false)
    .sort(
      (left, right) =>
        left.priority - right.priority || left.id.localeCompare(right.id),
    );
  const matched = sorted.filter((policy) => matchesPolicy(policy, context));

  const { actionable, shadow } = splitShadow(matched, mode);
  const virtualVerdict = severityMaxVirtualVerdict(shadow);

  const action =
    strategy === "first-match"
      ? (actionable[0]?.action ?? defaultAction)
      : actionable.reduce<Action>(
          (strongest, policy) =>
            ACTION_RANK[policy.action] > ACTION_RANK[strongest]
              ? policy.action
              : strongest,
          defaultAction,
        );

  return {
    action,
    matchedPolicyIds: actionable.map(({ id }) => id),
    policies: actionable,
    dryRunAction: virtualVerdict?.action ?? null,
    dryRunMatchedPolicyIds: shadow.map(({ id }) => id),
    dryRunPolicies: shadow,
    wouldEscalate: computeWouldEscalate(action, virtualVerdict),
  };
}
