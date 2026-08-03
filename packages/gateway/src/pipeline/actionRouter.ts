// Pipeline stage ⑦ — action execution (GMCP-15). Routes a Policy Engine (⑥)
// verdict to one of four outcomes and emits a GuardEvent for each, so the
// Audit Logger/Replay Dashboard boundary (⑧/⑨) always sees what happened
// even when a branch throws (§4.1: emit is try/finally, not best-effort).
import { createHash, randomUUID } from "node:crypto";
import { mask, type Detection } from "../detect.js";
import type { ApprovalBackend, ApprovalDecision } from "../approval/backend.js";
import { emitApprovalCreated, emitApprovalResolved, emitGuardEvent } from "./events.js";
import { explainDecision, type ApprovalResolution } from "./explanation.js";
import { recordMaskDiff } from "./maskDiff.js";
import type { Action, GuardEvent, GuardEventDetection, PolicyDecision, RoutedResult, ToolCallContext } from "./types.js";

export interface RouterDeps {
  approvalBackend: ApprovalBackend;
}

const defaultApprovalConfig = { timeoutSeconds: 120, onTimeout: "block" as const, allowMaskedApproval: false };

export async function routeByVerdict(ctx: ToolCallContext, decision: PolicyDecision, deps: RouterDeps): Promise<RoutedResult> {
  switch (decision.verdict) {
    case "allow":
    case "warn":
      return passthrough(ctx, decision, decision.verdict);
    case "block":
      return blockWithStandardError(ctx, decision);
    case "mask_then_allow":
      return maskThenAllow(ctx, decision);
    case "require_approval":
      return awaitApproval(ctx, decision, deps.approvalBackend);
  }
}

function passthrough(ctx: ToolCallContext, decision: PolicyDecision, verdict: "allow" | "warn"): RoutedResult {
  try {
    return computePassthrough(ctx, verdict);
  } finally {
    emitGuardEvent(buildGuardEvent(ctx, decision, verdict));
  }
}

function blockWithStandardError(ctx: ToolCallContext, decision: PolicyDecision): RoutedResult {
  try {
    return computeBlock(decision);
  } finally {
    emitGuardEvent(buildGuardEvent(ctx, decision, "block"));
  }
}

function maskThenAllow(ctx: ToolCallContext, decision: PolicyDecision): RoutedResult {
  let maskDiffRef: string | undefined;
  try {
    const computed = computeMask(ctx, decision);
    maskDiffRef = computed.maskDiffRef;
    return computed.result;
  } finally {
    emitGuardEvent(buildGuardEvent(ctx, decision, "mask_then_allow", maskDiffRef ? { maskDiffRef } : {}));
  }
}

/** §4.5: submit → wait up to `approval.timeoutSeconds` (fail-closed on timeout) → replay 4.2/4.3/4.4 with the resolved outcome. */
async function awaitApproval(ctx: ToolCallContext, decision: PolicyDecision, backend: ApprovalBackend): Promise<RoutedResult> {
  const approval = decision.approval ?? defaultApprovalConfig;

  const pendingEvent = buildGuardEvent(ctx, decision, "require_approval");
  emitGuardEvent(pendingEvent);

  const requestId = await backend.submit({
    eventRef: pendingEvent.eventId,
    direction: ctx.direction,
    toolName: ctx.toolName,
    riskScore: decision.riskScore,
    matchedPolicyIds: decision.matchedPolicyIds
  });
  emitApprovalCreated({ requestId, eventRef: pendingEvent.eventId, timeoutSeconds: approval.timeoutSeconds });

  const rawDecision = await backend.awaitDecision(requestId, approval.timeoutSeconds * 1_000);
  emitApprovalResolved({ requestId, eventRef: pendingEvent.eventId, decision: rawDecision });

  const outcome = resolveApprovalOutcome(ctx, decision, rawDecision, approval.allowMaskedApproval);
  emitGuardEvent(buildGuardEvent(ctx, decision, outcome.verdict, {
    decidedBy: "approval-backend",
    decidedAt: new Date().toISOString(),
    ...(outcome.maskDiffRef ? { maskDiffRef: outcome.maskDiffRef } : {})
  }, outcome.resolution));
  return outcome.result;
}

function resolveApprovalOutcome(
  ctx: ToolCallContext,
  decision: PolicyDecision,
  rawDecision: ApprovalDecision,
  allowMaskedApproval: boolean
): { verdict: Action; result: RoutedResult; maskDiffRef?: string; resolution: ApprovalResolution } {
  if (rawDecision === "approve") return { verdict: "allow", result: computePassthrough(ctx, "allow"), resolution: "approved" };
  if (rawDecision === "approve_masked" && allowMaskedApproval) {
    const { result, maskDiffRef } = computeMask(ctx, decision);
    return { verdict: "mask_then_allow", result, maskDiffRef, resolution: "masked" };
  }
  // "block", "expired", or an approve_masked the policy doesn't allow: fail closed (NFR-03).
  // A timeout and a refusal both end in a block, so the event records which one it was.
  return { verdict: "block", result: computeBlock(decision), resolution: rawDecision === "expired" ? "expired" : "denied" };
}

function computePassthrough(ctx: ToolCallContext, verdict: "allow" | "warn"): RoutedResult {
  return { verdict, payload: ctx.payload };
}

function computeBlock(decision: PolicyDecision): RoutedResult {
  const policyIds = decision.matchedPolicyIds;
  return {
    verdict: "block",
    error: {
      error: {
        code: "GUARD_BLOCKED",
        policyId: policyIds[0] ?? "unknown_policy",
        policyIds,
        reasonCode: decision.reasonCode,
        severity: decision.severity,
        message: decision.message
      }
    }
  };
}

/** Replaces detected spans back-to-front so earlier offsets never shift (§4.4). */
function computeMask(ctx: ToolCallContext, decision: PolicyDecision): { result: RoutedResult; maskDiffRef: string } {
  const masked = mask(ctx.payload, decision.detections);
  const maskDiffRef = recordMaskDiff(ctx.payload, masked);
  return { result: { verdict: "mask_then_allow", payload: masked }, maskDiffRef };
}

/** Shared so every producer of a GuardEvent normalizes spans the same way. */
export function toEventDetection(detection: Detection): GuardEventDetection {
  return {
    type: detection.type,
    subtype: detection.subtype,
    span: { start: detection.start, end: detection.end },
    confidence: detection.confidence,
    maskedAs: detection.maskedAs
  };
}

/** Shared so `argsDigest` always means "digest of the inspected payload" (§8.4). */
export function digest(payload: string): string {
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

interface GuardEventExtras {
  maskDiffRef?: string;
  decidedBy?: string;
  decidedAt?: string;
}

function buildGuardEvent(
  ctx: ToolCallContext,
  decision: PolicyDecision,
  verdict: Action,
  extras: GuardEventExtras = {},
  resolution?: ApprovalResolution
): GuardEvent {
  return {
    eventId: randomUUID(),
    sessionId: ctx.sessionId,
    ts: new Date().toISOString(),
    direction: ctx.direction,
    toolName: ctx.toolName,
    argsDigest: digest(ctx.payload),
    verdict,
    riskScore: decision.riskScore,
    matchedPolicyIds: decision.matchedPolicyIds,
    detections: decision.detections.map(toEventDetection),
    // Every event funnels through here, so generating the explanation at this one point
    // is what makes "100% of block events carry a reason" true rather than best-effort.
    explanation: explainDecision(decision, verdict, resolution),
    ...extras
  };
}
