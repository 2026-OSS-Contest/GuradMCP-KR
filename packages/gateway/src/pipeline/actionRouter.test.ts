import { describe, expect, it } from "vitest";
import { InMemoryApprovalBackend, type ApprovalBackend, type ApprovalDecision, type ApprovalRequestId } from "../approval/backend.js";
import type { Detection } from "../detect.js";
import { routeByVerdict, type RouterDeps } from "./actionRouter.js";
import { onGuardBusMessage } from "./events.js";
import type { PolicyDecision, ToolCallContext } from "./types.js";

const baseCtx: ToolCallContext = {
  direction: "request",
  toolName: "read_file",
  payload: JSON.stringify({ path: ".env" }),
  sessionId: "s-1",
  serverId: "demo-mcp-tools",
  serverTrust: "untrusted"
};

function stubBackend(overrides: Partial<ApprovalBackend> = {}): ApprovalBackend {
  return {
    async submit(): Promise<ApprovalRequestId> { return "req-stub"; },
    async awaitDecision(): Promise<ApprovalDecision> { return "expired"; },
    ...overrides
  };
}

function deps(overrides: Partial<ApprovalBackend> = {}): RouterDeps {
  return { approvalBackend: stubBackend(overrides) };
}

describe("blockWithStandardError (§4.3, FR-GW-05)", () => {
  const secret = "sk-ant-super-secret-token-should-never-leak";
  const payload = JSON.stringify({ note: secret });
  const decision: PolicyDecision = {
    verdict: "block",
    matchedPolicyIds: ["block_env_file_read", "block_untrusted_injection_response"],
    decidingPolicyId: "block_env_file_read",
    riskScore: 96,
    severity: "critical",
    reasonCode: "BLOCK_ENV_FILE_READ",
    message: "Credential-file access was blocked by policy.",
    detections: [{ type: "SECRET", subtype: "LLM_API_KEY", maskedAs: "[SECRET]", start: payload.indexOf(secret), end: payload.indexOf(secret) + secret.length, confidence: 0.95 }]
  };

  it("returns the standard error shape (§3.1/3.2) with no payload to forward", async () => {
    const routed = await routeByVerdict({ ...baseCtx, payload }, decision, deps());
    expect(routed.verdict).toBe("block");
    if (routed.verdict !== "block") throw new Error("expected block");
    expect(routed.error.code).toBe(-32001);
    expect(routed.error.message).toBe("GuardMCP-KR policy violation");
    const data = routed.error.data.guardmcp;
    expect(data).toMatchObject({
      schemaVersion: "1.0",
      policyId: "block_env_file_read",
      matchedPolicyIds: ["block_untrusted_injection_response"],
      // Not one of the §4 enum values, so it normalizes to the generic bucket.
      reasonCode: "POLICY_EXPLICIT_BLOCK",
      severity: "critical",
      message: "Credential-file access was blocked by policy.",
      riskScore: 96,
      sessionId: baseCtx.sessionId,
      detectionSummary: [{ type: "SECRET", subtype: "LLM_API_KEY", count: 1 }]
    });
    expect(data.eventId).toEqual(expect.any(String));
    expect(new Date(data.timestamp).toString()).not.toBe("Invalid Date");
    expect("payload" in routed).toBe(false);
  });

  it("never includes the raw detected text, or any span/offset, anywhere in the response (FR-GW-05 §6)", async () => {
    const routed = await routeByVerdict({ ...baseCtx, payload }, decision, deps());
    const serialized = JSON.stringify(routed);
    expect(serialized).not.toContain(secret);
    // §6: no span/offset object anywhere in the error body — check the JSON *keys*, not arbitrary
    // substrings, since e.g. riskScore's digits could otherwise collide with an offset value.
    expect(serialized).not.toContain('"start"');
    expect(serialized).not.toContain('"end"');
  });

  it("falls back to a placeholder policyId when nothing matched", async () => {
    const routed = await routeByVerdict({ ...baseCtx, payload }, { ...decision, matchedPolicyIds: [] }, deps());
    if (routed.verdict !== "block") throw new Error("expected block");
    expect(routed.error.data.guardmcp.policyId).toBe("unknown_policy");
    expect(routed.error.data.guardmcp.matchedPolicyIds).toBeUndefined();
  });

  it("shares one eventId between the returned error and the emitted GuardEvent (AC #5)", async () => {
    const seen: Array<{ eventId: string }> = [];
    const unsubscribe = onGuardBusMessage((message) => {
      if (message.type === "guard.event") seen.push(message.data as { eventId: string });
    });
    let routed: Awaited<ReturnType<typeof routeByVerdict>>;
    try {
      routed = await routeByVerdict({ ...baseCtx, payload }, decision, deps());
    } finally {
      unsubscribe();
    }
    if (routed.verdict !== "block") throw new Error("expected block");
    expect(seen).toHaveLength(1);
    expect(routed.error.data.guardmcp.eventId).toBe(seen[0]?.eventId);
  });

  it("uses APPROVAL_TIMEOUT_BLOCKED when a require_approval wait expires (§4)", async () => {
    const approvalDecision: PolicyDecision = {
      verdict: "require_approval",
      matchedPolicyIds: ["approve_external_email_with_secret"],
      decidingPolicyId: "approve_external_email_with_secret",
      riskScore: 88,
      severity: "high",
      reasonCode: "APPROVE_EXTERNAL_EMAIL_WITH_SECRET",
      message: "External transmission is waiting for human approval.",
      detections: [],
      approval: { timeoutSeconds: 0.01, onTimeout: "block", allowMaskedApproval: false }
    };
    const routed = await routeByVerdict(baseCtx, approvalDecision, { approvalBackend: new InMemoryApprovalBackend() });
    if (routed.verdict !== "block") throw new Error("expected block");
    expect(routed.error.data.guardmcp.reasonCode).toBe("APPROVAL_TIMEOUT_BLOCKED");
  });
});

describe("maskThenAllow (§4.4)", () => {
  it("replaces multiple spans back-to-front without offset drift", async () => {
    const payload = JSON.stringify({ a: "SECRET_AAAA", b: "SECRET_BBBB" });
    const spanOf = (needle: string) => ({ start: payload.indexOf(needle), end: payload.indexOf(needle) + needle.length });
    // Ascending order on purpose: the router (not the caller) is responsible for masking back-to-front.
    const detections: Detection[] = [
      { type: "SECRET", subtype: "GENERIC", maskedAs: "[SECRET]", confidence: 0.9, ...spanOf("SECRET_AAAA") },
      { type: "SECRET", subtype: "GENERIC", maskedAs: "[SECRET]", confidence: 0.9, ...spanOf("SECRET_BBBB") }
    ];
    const decision: PolicyDecision = {
      verdict: "mask_then_allow",
      matchedPolicyIds: ["mask_secrets"],
      decidingPolicyId: "mask_secrets",
      riskScore: 80,
      severity: "high",
      reasonCode: "MASK_SECRETS",
      message: "Secrets were masked before delivery.",
      detections
    };

    const routed = await routeByVerdict({ ...baseCtx, direction: "response", payload }, decision, deps());
    expect(routed.verdict).toBe("mask_then_allow");
    if (routed.verdict !== "mask_then_allow") throw new Error("expected mask_then_allow");
    expect(routed.payload).not.toContain("SECRET_AAAA");
    expect(routed.payload).not.toContain("SECRET_BBBB");
    expect(JSON.parse(routed.payload)).toEqual({ a: "[SECRET]", b: "[SECRET]" });
  });
});

describe("awaitApproval (§4.5, FR-APR-03)", () => {
  const decision: PolicyDecision = {
    verdict: "require_approval",
    matchedPolicyIds: ["approve_external_email_with_secret"],
    decidingPolicyId: "approve_external_email_with_secret",
    riskScore: 88,
    severity: "high",
    reasonCode: "APPROVE_EXTERNAL_EMAIL_WITH_SECRET",
    message: "External transmission is waiting for human approval.",
    detections: [],
    approval: { timeoutSeconds: 0.01, onTimeout: "block", allowMaskedApproval: true }
  };

  it("auto-blocks (fail-closed) once the timeout elapses unresolved, using the reference InMemoryApprovalBackend", async () => {
    const routed = await routeByVerdict(baseCtx, decision, { approvalBackend: new InMemoryApprovalBackend() });
    expect(routed.verdict).toBe("block");
  });

  it("delegates to the masking path on approve_masked", async () => {
    const payload = JSON.stringify({ body: "call 010-1234-5678" });
    const start = payload.indexOf("010-1234-5678");
    const withDetections: PolicyDecision = {
      ...decision,
      detections: [{ type: "PII", subtype: "PHONE", maskedAs: "[PHONE]", start, end: start + "010-1234-5678".length, confidence: 0.9 }]
    };
    const routed = await routeByVerdict({ ...baseCtx, payload }, withDetections, deps({ awaitDecision: async () => "approve_masked" }));
    expect(routed.verdict).toBe("mask_then_allow");
    if (routed.verdict !== "mask_then_allow") throw new Error("expected mask_then_allow");
    expect(routed.payload).toContain("[PHONE]");
    expect(routed.payload).not.toContain("010-1234-5678");
  });

  it("reuses the passthrough path on approve", async () => {
    const routed = await routeByVerdict(baseCtx, decision, deps({ awaitDecision: async () => "approve" }));
    expect(routed.verdict).toBe("allow");
    if (routed.verdict !== "allow") throw new Error("expected allow");
    expect(routed.payload).toBe(baseCtx.payload);
  });

  it("fails closed when approve_masked is returned but the policy disallows masked approval", async () => {
    const noMasking: PolicyDecision = { ...decision, approval: { ...decision.approval!, allowMaskedApproval: false } };
    const routed = await routeByVerdict(baseCtx, noMasking, deps({ awaitDecision: async () => "approve_masked" }));
    expect(routed.verdict).toBe("block");
  });
});

describe("GuardEvent emission (§4.1, §8.4 contract)", () => {
  it("emits a guard.event message shaped for the SSE bridge on every branch", async () => {
    const seen: unknown[] = [];
    const unsubscribe = onGuardBusMessage((message) => { if (message.type === "guard.event") seen.push(message.data); });
    try {
      const decision: PolicyDecision = {
        verdict: "allow",
        matchedPolicyIds: [],
        decidingPolicyId: null,
        riskScore: 0,
        severity: "info",
        reasonCode: "NO_POLICY_MATCH",
        message: "No policy matched.",
        detections: []
      };
      await routeByVerdict(baseCtx, decision, deps());
    } finally {
      unsubscribe();
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      sessionId: baseCtx.sessionId,
      direction: baseCtx.direction,
      toolName: baseCtx.toolName,
      verdict: "allow",
      matchedPolicyIds: []
    });
    const event = seen[0] as { eventId: string; ts: string; argsDigest: string };
    expect(event.eventId).toEqual(expect.any(String));
    expect(new Date(event.ts).toString()).not.toBe("Invalid Date");
    expect(event.argsDigest).not.toBe(baseCtx.payload);
  });

  it("emits require_approval (pending) then the resolved verdict as a follow-up event", async () => {
    const messages: Array<{ type: string; data: unknown }> = [];
    const unsubscribe = onGuardBusMessage((message) => messages.push(message));
    try {
      const decision: PolicyDecision = {
        verdict: "require_approval",
        matchedPolicyIds: ["approve_external_email_with_secret"],
        decidingPolicyId: "approve_external_email_with_secret",
        riskScore: 88,
        severity: "high",
        reasonCode: "APPROVE_EXTERNAL_EMAIL_WITH_SECRET",
        message: "waiting",
        detections: [],
        approval: { timeoutSeconds: 5, onTimeout: "block", allowMaskedApproval: false }
      };
      await routeByVerdict(baseCtx, decision, deps({ awaitDecision: async () => "block" }));
    } finally {
      unsubscribe();
    }
    const guardEvents = messages.filter((message) => message.type === "guard.event").map((message) => message.data as { verdict: string; decidedBy?: string });
    expect(guardEvents).toHaveLength(2);
    expect(guardEvents[0]?.verdict).toBe("require_approval");
    expect(guardEvents[0]?.decidedBy).toBeUndefined();
    expect(guardEvents[1]?.verdict).toBe("block");
    expect(guardEvents[1]?.decidedBy).toBe("approval-backend");
    expect(messages.map((message) => message.type)).toEqual(["guard.event", "approval.created", "approval.resolved", "guard.event"]);
  });
});

describe("NFR-01 latency smoke test (rule pipeline, ≤50ms p95 target)", () => {
  // Not a benchmark (that's M4's Benchmark Runner) — just a sanity check that
  // routing a 10KB payload stays well inside the p95 budget, so a gross
  // regression (e.g. an accidental deep clone) fails fast in CI.
  const payload = JSON.stringify({ note: "a".repeat(10 * 1024) });

  async function p95(run: () => Promise<unknown>): Promise<number> {
    const samples: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      const start = performance.now();
      await run();
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length * 0.95)] ?? 0;
  }

  it("keeps the allow path fast", async () => {
    const decision: PolicyDecision = {
      verdict: "allow", matchedPolicyIds: [], decidingPolicyId: null, riskScore: 0, severity: "info",
      reasonCode: "NO_POLICY_MATCH", message: "No policy matched.", detections: []
    };
    const latency = await p95(() => routeByVerdict({ ...baseCtx, payload }, decision, deps()));
    expect(latency).toBeLessThan(50);
  });

  it("keeps the block path fast", async () => {
    const decision: PolicyDecision = {
      verdict: "block", matchedPolicyIds: ["block_env_file_read"], decidingPolicyId: "block_env_file_read", riskScore: 96, severity: "critical",
      reasonCode: "BLOCK_ENV_FILE_READ", message: "Credential-file access was blocked by policy.", detections: []
    };
    const latency = await p95(() => routeByVerdict({ ...baseCtx, payload }, decision, deps()));
    expect(latency).toBeLessThan(50);
  });
});

describe("every guard event carries an explanation (GMCP-53)", () => {
  const decision: PolicyDecision = {
    verdict: "block",
    matchedPolicyIds: ["block_env_file_read"],
    decidingPolicyId: "block_env_file_read",
    riskScore: 96,
    severity: "critical",
    reasonCode: "BLOCK_ENV_FILE_READ",
    message: "Credential-file access was blocked by policy.",
    detections: []
  };

  async function eventsFor(verdict: PolicyDecision["verdict"]): Promise<Array<{ explanation?: { ko: string; en: string; reasonCode: string } }>> {
    const captured: Array<{ explanation?: { ko: string; en: string; reasonCode: string } }> = [];
    const unsubscribe = onGuardBusMessage((message) => {
      if (message.type === "guard.event") captured.push(message.data as { explanation?: { ko: string; en: string; reasonCode: string } });
    });
    await routeByVerdict(baseCtx, { ...decision, verdict }, deps());
    unsubscribe();
    return captured;
  }

  it("explains the verdict on every recorded event, in Korean and English", async () => {
    for (const verdict of ["allow", "warn", "mask_then_allow", "require_approval", "block"] as const) {
      const events = await eventsFor(verdict);
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.explanation?.reasonCode).toBe("BLOCK_ENV_FILE_READ");
        expect(event.explanation?.ko).toContain("block_env_file_read");
        expect(event.explanation?.en).toContain("block_env_file_read");
      }
    }
  });

  it("records a timed-out approval as the block it became, and says the timeout caused it", async () => {
    const events = await eventsFor("require_approval");
    // The backend stub expires, so the final event must read as a block (§4.5) — and a
    // block from a timeout has to be distinguishable from one a policy asked for.
    const final = events.at(-1)?.explanation;
    expect(final?.ko.startsWith("차단했습니다")).toBe(true);
    expect(final?.ko).toContain("승인 시간이 초과되어");
  });

  it("names the deciding policy in the event, not the first of several matches", async () => {
    const captured: Array<{ explanation?: { ko: string } }> = [];
    const unsubscribe = onGuardBusMessage((message) => {
      if (message.type === "guard.event") captured.push(message.data as { explanation?: { ko: string } });
    });
    await routeByVerdict(baseCtx, {
      ...decision,
      verdict: "block",
      matchedPolicyIds: ["warn_injection_request", "block_env_file_read"],
      decidingPolicyId: "block_env_file_read"
    }, deps());
    unsubscribe();
    expect(captured.at(-1)?.explanation?.ko).toContain("정책 block_env_file_read");
    expect(captured.at(-1)?.explanation?.ko).not.toContain("정책 warn_injection_request");
  });
});
