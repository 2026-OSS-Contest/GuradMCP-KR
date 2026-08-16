// The fail-closed/fail-open decision point itself (NFR-03, GMCP-68 §4.2).
//
// `evaluatePayload` (../server.ts) calls this exactly once, from the single catch around its
// whole pipeline run, whenever a stage throws a PipelineStageError. Every Tool Call funnels
// through that one call site, so "default is block" is a single branch here rather than
// something each detector could individually opt out of.
import { getFailurePolicy, type FailurePolicy } from "../settings/failurePolicyCache.js";
import { logJson } from "./logger.js";
import { recordPipelineError } from "./metrics.js";
import type { StageError } from "./pipelineRunner.js";
import type { PolicyDecision } from "./types.js";

const blockMessage = "게이트웨이 내부 오류로 요청이 차단되었습니다. 관리자에게 문의하세요.";
const failOpenMessage = "게이트웨이 내부 오류가 발생했지만 fail-open 설정으로 인해 요청이 통과되었습니다.";

/**
 * Builds the synthetic {@link PolicyDecision} a pipeline failure resolves to, reusing the same
 * `routeByVerdict`/`buildGuardEvent` machinery every normal decision goes through (so the block
 * error shape, the GuardEvent, and the audit publish all stay the one implementation).
 *
 * `matchedPolicyIds`/`detections` stay empty (REQ-05: no policy ever matched) and `verdict` is
 * `warn` rather than `allow` on the fail-open path — this codebase's action-router already
 * treats `warn` as a passthrough identical to `allow` (see `actionRouter.ts` `passthrough`), so
 * reusing it is what makes the emitted GuardEvent read as the REQ-04 "warn 수준" record without a
 * separate severity field GuardEvent doesn't have.
 */
export function handlePipelineFailure(stageError: StageError): PolicyDecision {
  const failurePolicy = getFailurePolicy();
  const failOpen = failurePolicy === "fail_open";

  recordPipelineError(stageError.stage, failOpen ? "fail_open" : "fail_closed");
  logJson("warn", "pipeline stage failed; applying failure policy", {
    stage: stageError.stage,
    errorClass: stageError.errorClass,
    timedOut: stageError.timedOut,
    failurePolicy
  });

  return {
    verdict: failOpen ? "warn" : "block",
    matchedPolicyIds: [],
    decidingPolicyId: null,
    riskScore: 0,
    severity: failOpen ? "high" : "critical",
    reasonCode: "GATEWAY_FAIL_CLOSED",
    message: failOpen ? failOpenMessage : blockMessage,
    detections: [],
    errorInfo: stageError,
    failurePolicyApplied: failurePolicy satisfies FailurePolicy
  };
}
