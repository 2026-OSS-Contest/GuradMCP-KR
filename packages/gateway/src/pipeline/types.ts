// Shared types for the action-execution stage (pipeline step ⑦, GMCP-15).
//
// `Detection` is intentionally NOT redefined here. The task doc (§3) sketches
// `{ span: { start, end } }`, but the detector that actually produces
// detections (`../detect.ts`) emits flat `start`/`end`. Following the
// precedent in `@guardmcp/policy-engine` (types.ts), the real detector output
// wins; spans are normalized to the `{ start, end }` shape only at the
// GuardEvent boundary (see `buildGuardEvent` in actionRouter.ts).
import type { Action, Direction, Severity, ServerTrust } from "@guardmcp/policy-engine";
import type { Detection } from "../detect.js";

export type { Action, Direction, Severity, ServerTrust };

/** Everything the router needs about the Tool Call being routed. */
export interface ToolCallContext {
  direction: Direction;
  toolName: string;
  /** The exact serialized text that was inspected; `decision.detections[].start/end` are offsets into this string. */
  payload: string;
  sessionId: string;
  serverTrust: ServerTrust;
}

/** Policy Engine (⑥) output, as consumed by the action router (§3). */
export interface PolicyDecision {
  verdict: Action;
  matchedPolicyIds: string[];
  riskScore: number;
  severity: Severity;
  reasonCode: string;
  message: string;
  detections: Detection[];
  approval?: {
    timeoutSeconds: number;
    onTimeout: "block";
    allowMaskedApproval: boolean;
  };
}

/** FR-GW-05 standard block error. Never carries raw detected text or spans. */
export interface GuardBlockError {
  error: {
    code: "GUARD_BLOCKED";
    policyId: string;
    policyIds: string[];
    reasonCode: string;
    severity: string;
    message: string;
  };
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
  maskDiffRef?: string;
  decidedBy?: string;
  decidedAt?: string;
}
