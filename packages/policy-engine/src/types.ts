// Shared type definitions for the policy engine.
//
// GMCP-7 (Policy Matcher, FR-POL-01) asks for these types to live in a
// dedicated `types.ts` that other packages (control plane, decision engine)
// can reference. Consumers import them through the package entry point
// (`@guardmcp/policy-engine`), which re-exports everything here.
//
// Where the GMCP-7 spec and the authoritative Tool Call schema
// (`docs/spec-docs/tool-call-schema.spec.md`, D.5) disagree, the schema wins
// because it is what the detector pipeline actually emits and what GMCP-12
// (Decision Engine) consumes:
//   - `detections` is `Detection[]` (structured objects), not a flat
//     `DetectionType[]`. The flat form in the GMCP-7 draft was a
//     simplification; see `DetectionType` below for how it maps.

export const actions = [
  "allow",
  "mask_then_allow",
  "warn",
  "require_approval",
  "block",
] as const;
export const severities = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
] as const;

/**
 * FR-GW-05 (`docs/task-docs/GMCP-67/FR-GW-05-block-error-object-spec.md` §4)
 * taxonomy for standardized block errors. Lives here, not in the gateway,
 * because `Policy.reasonCode` below is a DSL-level concept — same reasoning
 * as `Action`/`Severity` already living in this file and being re-exported
 * through `@guardmcp/gateway`'s pipeline types.
 */
export const reasonCodes = [
  "PII_EXPOSURE_BLOCKED",
  "SECRET_EXPOSURE_BLOCKED",
  "SECRET_FILE_ACCESS_BLOCKED",
  "PROMPT_INJECTION_DETECTED",
  "TOOL_DESCRIPTION_TAMPERED",
  "UNTRUSTED_SERVER_ESCALATION",
  "BULK_EXFIL_SUSPECTED",
  "APPROVAL_TIMEOUT_BLOCKED",
  "POLICY_EXPLICIT_BLOCK",
  "GATEWAY_FAIL_CLOSED",
] as const;

export type Action = (typeof actions)[number];
export type Severity = (typeof severities)[number];
export type ReasonCode = (typeof reasonCodes)[number];
export type Direction = "request" | "response";
export type ServerTrust = "trusted" | "limited" | "untrusted";
export type EvaluationStrategy = "severity-max" | "first-match";

/**
 * Detection vocabulary used when *authoring* `detections.any_of` in a policy.
 *
 * A runtime {@link Detection} carries a coarse `type` (`PII | SECRET |
 * INJECTION`) plus a fine-grained `subtype`; the matcher combines them into
 * dotted tokens (`PII.RRN_LIKE`) so a policy can target either the coarse type
 * (`SECRET`) or a specific subtype (`PII.RRN_LIKE`). This union documents the
 * v1 tokens but is intentionally *not* used to constrain `any_of`, because
 * policy packs legitimately reference subtypes beyond this list
 * (e.g. `INJECTION.OBFUSCATED`).
 */
export type DetectionType =
  | "SECRET"
  | "PII.RRN_LIKE"
  | "PII.PHONE"
  | "PII.BANK_ACCOUNT"
  | "PII.BIZ_NO"
  | "PII.CARD"
  | "PII.ADDRESS"
  | "PII.PASSPORT"
  | "PII.DL_NO"
  | "INJECTION";

/** Structured detection result (Tool Call schema D.5). */
export interface Detection {
  type: string;
  subtype?: string;
}

/**
 * Evaluation context for a single Tool Call event (one direction).
 *
 * The matcher extracts path/URL/recipient values from `args` itself
 * (see matcher.ts §5.3/§5.4), so callers pass raw tool arguments unchanged.
 */
export interface PolicyContext {
  direction: Direction;
  tool: string;
  serverTrust: ServerTrust;
  args: Record<string, unknown>;
  detections: Detection[];
  riskScore: number; // 0-100
}

/** GMCP-7 spelling of {@link PolicyContext}; identical shape. */
export type ToolCallContext = PolicyContext;

export interface MatchDefinition {
  direction?: Direction | "any";
  tool?: string; // exact match, or glob when it contains `*`
  // A list matches when ctx.serverTrust is any of the listed grades (OR),
  // e.g. `[limited, untrusted]` to express "every grade except trusted".
  server_trust?: ServerTrust | ServerTrust[] | "any";
  args?: Record<string, unknown>;
  detections?: { any_of?: string[]; all_of?: string[]; none_of?: string[] };
  risk_score?: { gte?: number; lte?: number };
}

/**
 * GMCP-7 spelling of {@link MatchDefinition}.
 *
 * The GMCP-7 draft types `detections` as `{ any_of: DetectionType[] }` (only
 * the OR axis, required). The real contract is broader: policy packs and the
 * generated runtime bundle also use `all_of`/`none_of` and subtype tokens, so
 * this stays aliased to the wider {@link MatchDefinition}. The GMCP-7 shape is
 * a subset of it.
 */
export type PolicyMatch = MatchDefinition;

export interface Policy {
  id: string;
  pack: string;
  version?: number;
  description?: string;
  priority: number;
  match: MatchDefinition;
  action: Action;
  severity: Severity;
  message?: string;
  /** FR-GW-05 §7: optional explicit taxonomy code; the gateway infers one (§4) when absent. */
  reasonCode?: ReasonCode;
  enabled?: boolean;
  approval?: {
    timeout_seconds: number;
    on_timeout: "block";
    allow_masked_approval?: boolean;
  };
}

/** Output of the GMCP-7 `evaluate()` pipeline wrapper (index.ts). */
export interface MatchEvaluation {
  action: Action;
  matchedPolicyIds: string[];
  policies: Policy[];
}

/**
 * Policy-pack-level settings that steer `evaluatePolicies()` (GMCP-75,
 * FR-POL-02, 부록 A.3). `rules` mirrors the pack's full policy list as
 * loaded from its manifest (`policy-packs/*\/pack.yaml`); callers may pass a
 * different (e.g. activation-filtered) rule set as `evaluatePolicies`'s own
 * `rules` argument, so the two are not required to be identical.
 */
export interface PolicyPackConfig {
  name: string;
  strategy: EvaluationStrategy;
  /** Explicit value always wins; see {@link resolveDefaultAction}. */
  default_action?: Action | undefined;
  /** When `default_action` is unset, `true` resolves to `warn`, `false`/unset to `allow`. */
  strict?: boolean | undefined;
  rules: Policy[];
}

/**
 * `evaluatePolicies()` output (GMCP-75, 부록 A.3 규칙 5): every matched
 * policy id is always recorded, even under `first-match`, where only the
 * *action* adoption short-circuits at the first match.
 */
export interface EvaluationResult {
  action: Action;
  severity: Severity | null; // null when default_action was adopted
  matchedPolicyIds: string[]; // priority-ascending; full list, not just the winner
  winningPolicyId: string | null; // policy that decided `action`; null when unmatched
  strategy: EvaluationStrategy;
  usedDefault: boolean; // true when no policy matched and default_action was used
}

/**
 * GMCP-12 (Decision Engine, FR-POL-02) input/output contract.
 *
 * `decide()` (decide.ts) is the pipeline-stage-⑥ entry point: it takes the
 * Risk Scorer's output (stage ⑤) plus the already loaded/activated policy
 * list and produces a single verdict. Field names mirror the task spec
 * (`docs/task-docs/GMCP-12/decision-engine.md` §4) rather than
 * {@link PolicyContext}/{@link MatchEvaluation} above, because
 * `DecisionResult` maps directly onto `GuardEvent` (§4.2):
 *   GuardEvent.verdict          = DecisionResult.verdict
 *   GuardEvent.matchedPolicyIds = DecisionResult.matchedPolicyIds
 *
 * As of GMCP-75, `decide()` is a thin adapter over `evaluatePolicies()`
 * (evaluate.ts); see that module for the actual strategy/default_action
 * algorithm.
 */
export interface DecisionEvent {
  direction: Direction;
  toolName: string;
  serverTrust: ServerTrust;
  args: Record<string, unknown>;
}

export interface DecisionInput {
  event: DecisionEvent;
  detections: Detection[];
  riskScore: number; // 0-100
  activePolicies: Policy[];
  strategy?: EvaluationStrategy; // default: severity-max
  defaultAction?: Action; // policy-pack default_action; when set, wins over strictMode
  strictMode?: boolean; // true: unmatched events resolve to warn, but only when defaultAction is unset
}

export interface DecisionResult {
  verdict: Action;
  matchedPolicyIds: string[]; // all matched policies, in priority-ascending order
  decidingPolicyId: string | null; // policy that decided verdict; null when unmatched
  reason: string;
}
