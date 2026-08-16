import { beforeEach, describe, expect, it } from "vitest";
import { resetFailurePolicyCache, setFailurePolicy } from "../settings/failurePolicyCache.js";
import { handlePipelineFailure } from "./failsafe.js";
import { pipelineErrorMetricsSnapshot, resetMetrics } from "./metrics.js";
import type { StageError } from "./pipelineRunner.js";

const stageError: StageError = {
  stage: "policy_engine",
  errorClass: "Error",
  message: "boom",
  timedOut: false
};

beforeEach(() => {
  resetFailurePolicyCache();
  resetMetrics();
});

describe("handlePipelineFailure", () => {
  it("blocks by default (cold cache / no explicit setting, NFR-03 REQ-03/REQ-07)", () => {
    const decision = handlePipelineFailure(stageError);
    expect(decision.verdict).toBe("block");
    expect(decision.reasonCode).toBe("GATEWAY_FAIL_CLOSED");
    expect(decision.matchedPolicyIds).toEqual([]);
    expect(decision.detections).toEqual([]);
    expect(decision.errorInfo).toEqual(stageError);
    expect(decision.failurePolicyApplied).toBe("fail_closed");
  });

  it("blocks when failurePolicy=fail_closed explicitly", () => {
    setFailurePolicy("fail_closed");
    expect(handlePipelineFailure(stageError).verdict).toBe("block");
  });

  it("passes through as warn when failurePolicy=fail_open (REQ-04)", () => {
    setFailurePolicy("fail_open");
    const decision = handlePipelineFailure(stageError);
    expect(decision.verdict).toBe("warn");
    expect(decision.failurePolicyApplied).toBe("fail_open");
    expect(decision.errorInfo).toEqual(stageError);
  });

  it("never leaks the underlying error message into the agent-facing message (FR-GW-05, NFR-04)", () => {
    const sensitive: StageError = { ...stageError, message: "010-1234-5678 leaked in a stack trace" };
    const decision = handlePipelineFailure(sensitive);
    expect(decision.message).not.toContain("010-1234-5678");
  });

  it("increments the pipeline error metric for the applied outcome (NFR-06)", () => {
    setFailurePolicy("fail_open");
    handlePipelineFailure({ ...stageError, stage: "detection" });
    expect(pipelineErrorMetricsSnapshot()).toEqual({ "detection:fail_open": 1 });
  });
});
