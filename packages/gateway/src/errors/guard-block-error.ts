// FR-GW-05 — standardized `block` error object.
// (docs/task-docs/GMCP-67/FR-GW-05-block-error-object-spec.md)
//
// §7 sketches `buildGuardBlockError(input: { event: GuardEvent; policy: Policy;
// explanation })`, then claims the input type itself keeps `GuardEvent`'s
// `detections[].span`/`argsDigest` out of the error. But `GuardEvent` (see
// `../pipeline/types.ts`) carries both, so passing it through whole would
// defeat that guarantee. `buildGuardBlockError` below takes a flat set of
// primitives plus pre-aggregated `DetectionSummaryItem[]` instead — span and
// digest fields are structurally absent, not just unused, which is what §7
// actually means by "컴파일 타임에 원문 유입을 막는다". Callers (`../pipeline/
// actionRouter.ts`) own the `GuardEvent`/`Policy` and are responsible for
// projecting down to this shape via `summarizeDetections`.
import { reasonCodes, type ReasonCode, type Severity } from "@guardmcp/policy-engine";
import type { Detection } from "../detect.js";

export type { ReasonCode };

const reasonCodeSet: ReadonlySet<string> = new Set(reasonCodes);

/** §3.2: only detection *type*, *subtype*, and *count* ever leave the gateway — never span/offset/masked value. */
export interface DetectionSummaryItem {
  type: string;
  subtype: string;
  count: number;
}

/** §3.2/3.3: payload nested under `error.data.guardmcp`. */
export interface GuardBlockErrorData {
  schemaVersion: "1.0";
  eventId: string;
  policyId: string;
  reasonCode: ReasonCode;
  severity: Severity;
  message: string;
  detectionSummary?: DetectionSummaryItem[];
  riskScore?: number;
  sessionId: string;
  timestamp: string;
  matchedPolicyIds?: string[];
}

/** §3.1: JSON-RPC error envelope. `code`/`message` are fixed; `reasonCode` carries the detail (no per-cause code splitting). */
export interface GuardBlockError {
  code: -32001;
  message: "GuardMCP-KR policy violation";
  data: { guardmcp: GuardBlockErrorData };
}

export interface GuardBlockErrorInput {
  eventId: string;
  sessionId: string;
  timestamp: string;
  policyId: string;
  /** Raw value from the deciding policy/`PolicyDecision`; normalized against §4's enum (see `resolveReasonCode`). */
  reasonCode: string;
  severity: Severity;
  /** Explanation Generator (GMCP-53) output, or the policy's static `message` when GMCP-53 is unavailable/unwired (§5.1). */
  message: string;
  detectionSummary: DetectionSummaryItem[];
  riskScore?: number;
  /** Policies matched *besides* `policyId` (§3.2: audit-only, excludes the deciding policy itself). */
  matchedPolicyIds?: string[];
}

/** §4: an unset or unrecognized reasonCode falls back to the general "policy author blocked this explicitly" bucket. */
function resolveReasonCode(raw: string): ReasonCode {
  return reasonCodeSet.has(raw) ? (raw as ReasonCode) : "POLICY_EXPLICIT_BLOCK";
}

export function buildGuardBlockError(input: GuardBlockErrorInput): GuardBlockError {
  return {
    code: -32001,
    message: "GuardMCP-KR policy violation",
    data: {
      guardmcp: {
        schemaVersion: "1.0",
        eventId: input.eventId,
        policyId: input.policyId,
        reasonCode: resolveReasonCode(input.reasonCode),
        severity: input.severity,
        message: input.message,
        sessionId: input.sessionId,
        timestamp: input.timestamp,
        ...(input.detectionSummary.length > 0 ? { detectionSummary: input.detectionSummary } : {}),
        ...(input.riskScore !== undefined ? { riskScore: input.riskScore } : {}),
        ...(input.matchedPolicyIds && input.matchedPolicyIds.length > 0 ? { matchedPolicyIds: input.matchedPolicyIds } : {})
      }
    }
  };
}

/** §6: reduces raw detections to type+subtype+count. `Detection` never carries raw matched text, but does carry `start`/`end`; those are intentionally dropped here since §6 forbids span/offset in the error body. */
export function summarizeDetections(detections: Detection[]): DetectionSummaryItem[] {
  const counts = new Map<string, DetectionSummaryItem>();
  for (const { type, subtype } of detections) {
    const key = `${type}:${subtype}`;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { type, subtype, count: 1 });
  }
  return [...counts.values()];
}
