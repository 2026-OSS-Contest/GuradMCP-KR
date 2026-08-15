// Shared types for the action-execution stage (pipeline step ⑦, GMCP-15).
//
// `Detection` is intentionally NOT redefined here. The task doc (§3) sketches
// `{ span: { start, end } }`, but the detector that actually produces
// detections (`../detect.ts`) emits flat `start`/`end`. Following the
// precedent in `@guardmcp/policy-engine` (types.ts), the real detector output
// wins; spans are normalized to the `{ start, end }` shape only at the
// GuardEvent boundary (see `buildGuardEvent` in actionRouter.ts).
import type {
  Action,
  Direction,
  ReasonCode,
  Severity,
  ServerTrust,
} from "@guardmcp/policy-engine";
import type { Detection } from "../detect.js";
import type { GuardBlockError } from "../errors/guard-block-error.js";
import type { FailurePolicy } from "../settings/failurePolicyCache.js";
import type { StageError } from "./pipelineRunner.js";

export type {
  Action,
  Direction,
  ReasonCode,
  Severity,
  ServerTrust,
  GuardBlockError,
  FailurePolicy,
  StageError,
};

/** Everything the router needs about the Tool Call being routed. */
export interface ToolCallContext {
  direction: Direction;
  toolName: string;
  /** The exact serialized text that was inspected; `decision.detections[].start/end` are offsets into this string. */
  payload: string;
  sessionId: string;
  /** Upstream MCP server this call targeted (FR-GW-02 §3.3). */
  serverId: string;
  serverTrust: ServerTrust;
}

/** Policy Engine (⑥) output, as consumed by the action router (§3). */
export interface PolicyDecision {
  verdict: Action;
  /** Every policy that matched, in evaluation order (priority ascending). */
  matchedPolicyIds: string[];
  /**
   * The policy whose action was adopted, which under `severity-max` is chosen by action
   * strength and is therefore usually **not** `matchedPolicyIds[0]`. `severity`,
   * `reasonCode`, and `message` all come from this policy, so anything naming the
   * deciding policy has to read it here or it will contradict them. Null when nothing
   * matched and the pack's default action applied.
   */
  decidingPolicyId: string | null;
  riskScore: number;
  severity: Severity;
  reasonCode: string;
  message: string;
  detections: Detection[];
  /** FR-SEC-04 §3.3: the path-like arg (path/file_path/filename) after normalization, when present. */
  normalizedPath?: string;
  approval?: {
    timeoutSeconds: number;
    onTimeout: "block";
    allowMaskedApproval: boolean;
  };
  /**
   * Present only on a decision synthesized by the pipeline's fail-closed/fail-open boundary
   * (NFR-03, GMCP-68 §4.2) — never set by the Policy Engine itself. Carried through to the
   * emitted GuardEvent by `buildGuardEvent` (actionRouter.ts).
   */
  errorInfo?: StageError;
  failurePolicyApplied?: FailurePolicy;
}

export type RoutedResult =
  | { verdict: Exclude<Action, "block" | "require_approval">; payload: string }
  | { verdict: "block"; error: GuardBlockError };

/** Normalized detection shape used only on the GuardEvent wire format (§8.4). */
export interface GuardEventDetection {
  type: string;
  subtype: string;
  span: { start: number; end: number };
  confidence: number;
  maskedAs: string;
}

/**
 * Human-readable reason for a verdict (GMCP-53). Lives here rather than in
 * `explanation.ts` so the type flows one way: the generator depends on these shared
 * types, not the reverse.
 */
export interface Explanation {
  /** Stable machine key, unchanged across locales. */
  reasonCode: string;
  /** Korean sentence, the console's default locale. */
  ko: string;
  /** English sentence for the same verdict. */
  en: string;
}

/** §8.4 core data model, trimmed to what this stage populates. */
export interface GuardEvent {
  eventId: string;
  sessionId: string;
  ts: string;
  direction: Direction;
  toolName: string;
  /** Digest of the inspected payload, never the raw text (NFR-04). */
  argsDigest: string;
  verdict: Action;
  riskScore: number;
  matchedPolicyIds: string[];
  detections: GuardEventDetection[];
  /**
   * Human-readable reason for this verdict in Korean and English (GMCP-53). Present on
   * every event so an explanation never has to be reconstructed by a reader.
   */
  explanation: Explanation;
  /** FR-GW-02 §3.3: the upstream server the Tool Call targeted, and its trust grade *at
   * decision time* — a snapshot, so a later grade change never rewrites past events' basis. */
  targetServerId: string;
  targetServerTrust: ServerTrust;
  /** FR-SEC-04 §3.3: normalized form of a path-like Tool Call arg, when one was present. */
  normalizedPath?: string;
  maskDiffRef?: string;
  decidedBy?: string;
  decidedAt?: string;
  /**
   * GMCP-68 §3.2: present only when this event resulted from a pipeline error/timeout instead of
   * a normal verdict. Absent (never `null`) on every other event, matching this type's existing
   * convention for optional fields (`normalizedPath`, `maskDiffRef`, ...).
   */
  errorInfo?: StageError;
  /** The failure policy actually applied to produce this event's verdict; absent on a normal decision. */
  failurePolicyApplied?: FailurePolicy;
  /**
   * NFR-04 opt-in only: populated by `buildGuardEvent` (actionRouter.ts) solely when
   * `AUDIT_STORE_RAW_PAYLOAD=true`. `./auditPublisher.ts` must be the only reader — it strips
   * this from the shared bus object synchronously before any other `guardEventBus` subscriber
   * (e.g. a future SSE writer) can observe it. Every other consumer must treat it as absent.
   */
  rawPayload?: string;
}
