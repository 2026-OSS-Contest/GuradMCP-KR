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
  DetectionType,
  Detection,
  PolicyContext,
  ToolCallContext,
  MatchDefinition,
  PolicyMatch,
  Policy,
  MatchEvaluation,
  PolicyPackConfig,
  EvaluationResult,
  DecisionEvent,
  DecisionInput,
  DecisionResult,
  ReasonCode,
} from "./types.js";
export { actions, severities, reasonCodes } from "./types.js";

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
  MatchEvaluation,
  EvaluationStrategy,
  Policy,
  PolicyContext,
} from "./types.js";
import { matchesPolicy } from "./matcher.js";

export function evaluate(
  policies: Policy[],
  context: PolicyContext,
  defaultAction: Action = "allow",

  strategy: EvaluationStrategy = "severity-max",
): MatchEvaluation {
  const matched = [...policies]
    .filter((policy) => policy.enabled !== false)
    .sort(
      (left, right) =>
        left.priority - right.priority || left.id.localeCompare(right.id),
    )
    .filter((policy) => matchesPolicy(policy, context));

  const actionWeight: Record<Action, number> = {
    allow: 0,
    mask_then_allow: 1,
    warn: 2,
    require_approval: 3,
    block: 4,
  };

  const action =
    strategy === "first-match"
      ? (matched[0]?.action ?? defaultAction)
      : matched.reduce<Action>(
          (strongest, policy) =>
            actionWeight[policy.action] > actionWeight[strongest]
              ? policy.action
              : strongest,
          defaultAction,
        );

  return {
    action,
    matchedPolicyIds: matched.map(({ id }) => id),
    policies: matched,
  };
}
