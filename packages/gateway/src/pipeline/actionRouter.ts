// Pipeline stage ⑦ — action execution (GMCP-15). Routes a Policy Engine (⑥)
// verdict to one of four outcomes and emits a GuardEvent for each, so the
// Audit Logger/Replay Dashboard boundary (⑧/⑨) always sees what happened
// even when a branch throws (§4.1: emit is try/finally, not best-effort).
import { createHash, randomUUID } from "node:crypto";
import { mask, type Detection } from "../detect.js";
import type { ApprovalBackend, ApprovalDecision } from "../approval/backend.js";
import {
  buildGuardBlockError,
  summarizeDetections,
} from "../errors/guard-block-error.js";
import {
  emitApprovalCreated,
  emitApprovalResolved,
  emitGuardEvent,
} from "./events.js";
import { explainDecision, type ApprovalResolution } from "./explanation.js";
import { recordMaskDiff } from "./maskDiff.js";
import type {
  Action,
  GuardEvent,
  GuardEventDetection,
  PolicyDecision,
  RoutedResult,
  ToolCallContext,
} from "./types.js";

export interface RouterDeps {
  approvalBackend: ApprovalBackend;
}

// NFR-04: off by default. See GuardEvent.rawPayload (types.ts) for who's allowed to read this.
const storeRawPayload = process.env.AUDIT_STORE_RAW_PAYLOAD === "true";

const defaultApprovalConfig = {
  timeoutSeconds: 120,
  onTimeout: "block" as const,
  allowMaskedApproval: false,
};

export async function routeByVerdict(
  ctx: ToolCallContext,
  decision: PolicyDecision,
  deps: RouterDeps,
): Promise<RoutedResult> {
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

function passthrough(
  ctx: ToolCallContext,
  decision: PolicyDecision,
  verdict: "allow" | "warn",
): RoutedResult {
  try {
    return computePassthrough(ctx, verdict);
  } finally {
    emitGuardEvent(buildGuardEvent(ctx, decision, verdict));
  }
}

function blockWithStandardError(
  ctx: ToolCallContext,
  decision: PolicyDecision,
): RoutedResult {
  // Minted once so the error returned to the Agent and the GuardEvent emitted for Replay
  // share one eventId/timestamp (AC #5: `/replay/{sessionId}?event={eventId}` must resolve).
  const eventId = randomUUID();
  const ts = new Date().toISOString();
  try {
    return computeBlock(ctx, decision, eventId, ts);
  } finally {
    emitGuardEvent(buildGuardEvent(ctx, decision, "block", { eventId, ts }));
  }
}

function maskThenAllow(
  ctx: ToolCallContext,
  decision: PolicyDecision,
): RoutedResult {
  let maskDiffRef: string | undefined;
  try {
    const computed = computeMask(ctx, decision);
    maskDiffRef = computed.maskDiffRef;
    return computed.result;
  } finally {
    emitGuardEvent(
      buildGuardEvent(
        ctx,
        decision,
        "mask_then_allow",
        maskDiffRef ? { maskDiffRef } : {},
      ),
    );
  }
}

/** §4.5: submit → wait up to `approval.timeoutSeconds` (fail-closed on timeout) → replay 4.2/4.3/4.4 with the resolved outcome. */
async function awaitApproval(
  ctx: ToolCallContext,
  decision: PolicyDecision,
  backend: ApprovalBackend,
): Promise<RoutedResult> {
  const approval = decision.approval ?? defaultApprovalConfig;

  const pendingEvent = buildGuardEvent(ctx, decision, "require_approval");
  emitGuardEvent(pendingEvent);

  const requestId = await backend.submit({
    eventRef: pendingEvent.eventId,
    direction: ctx.direction,
    toolName: ctx.toolName,
    riskScore: decision.riskScore,
    matchedPolicyIds: decision.matchedPolicyIds,
  });
  emitApprovalCreated({
    requestId,
    eventRef: pendingEvent.eventId,
    timeoutSeconds: approval.timeoutSeconds,
  });

  const rawDecision = await backend.awaitDecision(
    requestId,
    approval.timeoutSeconds * 1_000,
  );
  emitApprovalResolved({
    requestId,
    eventRef: pendingEvent.eventId,
    decision: rawDecision,
  });

  // Same eventId/timestamp pairing rationale as `blockWithStandardError` above.
  const resolvedEventId = randomUUID();
  const resolvedTs = new Date().toISOString();
  const outcome = resolveApprovalOutcome(
    ctx,
    decision,
    rawDecision,
    approval.allowMaskedApproval,
    resolvedEventId,
    resolvedTs,
  );
  emitGuardEvent(
    buildGuardEvent(
      ctx,
      decision,
      outcome.verdict,
      {
        eventId: resolvedEventId,
        ts: resolvedTs,
        decidedBy: "approval-backend",
        decidedAt: new Date().toISOString(),
        ...(outcome.maskDiffRef ? { maskDiffRef: outcome.maskDiffRef } : {}),
      },
      outcome.resolution,
    ),
  );
  return outcome.result;
}

function resolveApprovalOutcome(
  ctx: ToolCallContext,
  decision: PolicyDecision,
  rawDecision: ApprovalDecision,
  allowMaskedApproval: boolean,
  eventId: string,
  ts: string,
): {
  verdict: Action;
  result: RoutedResult;
  maskDiffRef?: string;
  resolution: ApprovalResolution;
} {
  if (rawDecision === "approve")
    return {
      verdict: "allow",
      result: computePassthrough(ctx, "allow"),
      resolution: "approved",
    };
  if (rawDecision === "approve_masked" && allowMaskedApproval) {
    const { result, maskDiffRef } = computeMask(ctx, decision);
    return {
      verdict: "mask_then_allow",
      result,
      maskDiffRef,
      resolution: "masked",
    };
  }
  // "expired": the wait itself timed out, so reasonCode APPROVAL_TIMEOUT_BLOCKED (§4) applies.
  // "block" (reviewer explicitly denied it) and a disallowed approve_masked both had a real
  // reviewer response — neither is a timeout — so they keep the deciding policy's own reasonCode.
  // Either way it is a fail-closed block (NFR-03), and the resolution records which one it was.
  const reasonCode =
    rawDecision === "expired"
      ? "APPROVAL_TIMEOUT_BLOCKED"
      : decision.reasonCode;
  return {
    verdict: "block",
    result: computeBlock(ctx, { ...decision, reasonCode }, eventId, ts),
    resolution: rawDecision === "expired" ? "expired" : "denied",
  };
}

function computePassthrough(
  ctx: ToolCallContext,
  verdict: "allow" | "warn",
): RoutedResult {
  return { verdict, payload: ctx.payload };
}

function computeBlock(
  ctx: ToolCallContext,
  decision: PolicyDecision,
  eventId: string,
  ts: string,
): RoutedResult {
  const policyId = decision.matchedPolicyIds[0] ?? "unknown_policy";
  return {
    verdict: "block",
    error: buildGuardBlockError({
      eventId,
      sessionId: ctx.sessionId,
      timestamp: ts,
      policyId,
      reasonCode: decision.reasonCode,
      severity: decision.severity,
      message: decision.message,
      detectionSummary: summarizeDetections(decision.detections),
      riskScore: decision.riskScore,
      matchedPolicyIds: decision.matchedPolicyIds.filter(
        (id) => id !== policyId,
      ),
    }),
  };
}

/** Replaces detected spans back-to-front so earlier offsets never shift (§4.4). */
function computeMask(
  ctx: ToolCallContext,
  decision: PolicyDecision,
): { result: RoutedResult; maskDiffRef: string } {
  const masked = mask(ctx.payload, decision.detections);
  const maskDiffRef = recordMaskDiff(ctx.payload, masked);
  return {
    result: { verdict: "mask_then_allow", payload: masked },
    maskDiffRef,
  };
}

/** Shared so every producer of a GuardEvent normalizes spans the same way. */
export function toEventDetection(detection: Detection): GuardEventDetection {
  return {
    type: detection.type,
    subtype: detection.subtype,
    span: { start: detection.start, end: detection.end },
    confidence: detection.confidence,
    maskedAs: detection.maskedAs,
  };
}

/** Shared so `argsDigest` always means "digest of the inspected payload" (§8.4). */
export function digest(payload: string): string {
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

interface GuardEventExtras {
  /** Overrides the minted eventId/ts — used by block paths so the error and its GuardEvent match (see callers above). */
  eventId?: string;
  ts?: string;
  maskDiffRef?: string;
  decidedBy?: string;
  decidedAt?: string;
}

function buildGuardEvent(
  ctx: ToolCallContext,
  decision: PolicyDecision,
  verdict: Action,
  extras: GuardEventExtras = {},
  resolution?: ApprovalResolution,
): GuardEvent {
  const { eventId, ts, ...rest } = extras;
  return {
    eventId: eventId ?? randomUUID(),
    sessionId: ctx.sessionId,
    ts: ts ?? new Date().toISOString(),
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
    targetServerId: ctx.serverId,
    targetServerTrust: ctx.serverTrust,
    ...rest,
    ...(decision.normalizedPath !== undefined
      ? { normalizedPath: decision.normalizedPath }
      : {}),
    // GMCP-68 §3.2: only a fail-closed/fail-open synthesized decision ever sets these.
    ...(decision.errorInfo !== undefined ? { errorInfo: decision.errorInfo } : {}),
    ...(decision.failurePolicyApplied !== undefined
      ? { failurePolicyApplied: decision.failurePolicyApplied }
      : {}),
    ...(storeRawPayload ? { rawPayload: ctx.payload } : {}),
    ...extras,
  };
}
