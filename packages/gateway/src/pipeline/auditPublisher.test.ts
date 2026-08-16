import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryApprovalBackend } from "../approval/backend.js";
import { routeByVerdict, type RouterDeps } from "./actionRouter.js";
import {
  auditPublisherMetrics,
  captureGuardEvent,
  flushAuditPublishQueue,
  resetAuditPublisherState,
  subscribeToGuardBus
} from "./auditPublisher.js";
import type { GuardEvent, PolicyDecision, ToolCallContext } from "./types.js";

function makeEvent(overrides: Partial<GuardEvent> = {}): GuardEvent {
  return {
    eventId: "e-1",
    sessionId: "s-1",
    ts: new Date().toISOString(),
    direction: "response",
    toolName: "read_file",
    argsDigest: "digest123",
    verdict: "block",
    riskScore: 90,
    matchedPolicyIds: ["block_env_file_read"],
    detections: [],
    explanation: {
      reasonCode: "BLOCK_ENV_FILE_READ",
      ko: "차단했습니다 — 정책 block_env_file_read (심각도 critical)",
      en: "Blocked — policy block_env_file_read (severity critical)"
    },
    targetServerId: "demo-mcp-tools",
    targetServerTrust: "untrusted",
    ...overrides
  };
}

function spyOnStdout() {
  return vi.spyOn(process.stdout, "write").mockImplementation(() => true);
}

function fetchMockResolving(status: number) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status }));
}

function fetchMockRejecting(message: string) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
    throw new Error(message);
  });
}

describe("auditPublisher", () => {
  let stdoutSpy: ReturnType<typeof spyOnStdout>;

  beforeEach(() => {
    resetAuditPublisherState();
    stdoutSpy = spyOnStdout();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    stdoutSpy.mockRestore();
  });

  it("logs a structured JSON line for every captured event (NFR-06)", () => {
    vi.stubGlobal("fetch", fetchMockResolving(201));

    captureGuardEvent(makeEvent({ eventId: "e-log", sessionId: "s-log", verdict: "warn" }));

    const line = stdoutSpy.mock.calls.map(([chunk]) => String(chunk)).find((chunk) => chunk.includes("e-log"));
    expect(line).toBeDefined();
    const parsed = JSON.parse(line!.trim());
    expect(parsed).toMatchObject({ eventId: "e-log", sessionId: "s-log", verdict: "warn", level: "info" });
    expect(typeof parsed.timestamp).toBe("string");
    expect(typeof parsed.message).toBe("string");
  });

  it("publishes to the Control Plane and counts the success", async () => {
    const fetchMock = fetchMockResolving(201);
    vi.stubGlobal("fetch", fetchMock);

    captureGuardEvent(makeEvent());
    await flushAuditPublishQueue();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({ eventId: "e-1", verdict: "block" });
    expect(auditPublisherMetrics()).toMatchObject({ published: 1, failed: 0, dropped: 0, queueDepth: 0 });
  });

  it("swallows a publish failure instead of throwing, and counts it (AUDIT-04)", async () => {
    vi.stubGlobal("fetch", fetchMockRejecting("ECONNREFUSED"));

    expect(() => captureGuardEvent(makeEvent())).not.toThrow();
    await flushAuditPublishQueue();

    expect(auditPublisherMetrics()).toMatchObject({ published: 0, failed: 1, queueDepth: 0 });
  });

  it("drops events once the bounded queue is full, without losing the ones already queued", async () => {
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
        await firstGate;
        return new Response(null, { status: 201 });
      })
    );

    // Kicks off drain(), which immediately dequeues this event and blocks on firstGate — every
    // subsequent call in this test synchronously piles up in `queue` behind it.
    captureGuardEvent(makeEvent({ eventId: "e-0" }));

    const capacity = 500;
    for (let index = 0; index < capacity + 1; index += 1) {
      captureGuardEvent(makeEvent({ eventId: `e-${index + 1}` }));
    }

    expect(auditPublisherMetrics()).toMatchObject({ dropped: 1, queueDepth: capacity });

    releaseFirst();
    await flushAuditPublishQueue();

    expect(auditPublisherMetrics()).toMatchObject({ published: capacity + 1, dropped: 1, queueDepth: 0 });
  });

  it("strips rawPayload from the shared bus object but still forwards it when present (NFR-04 opt-in)", async () => {
    const fetchMock = fetchMockResolving(201);
    vi.stubGlobal("fetch", fetchMock);

    const event = makeEvent({ rawPayload: "010-1234-5678 unmasked" });
    captureGuardEvent(event);

    // Any other guardEventBus subscriber receiving this same object reference must never see it.
    expect(event.rawPayload).toBeUndefined();

    await flushAuditPublishQueue();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body)).rawPayload).toBe("010-1234-5678 unmasked");
  });

  it("does not attach rawPayload when the gateway hasn't opted in", async () => {
    const fetchMock = fetchMockResolving(201);
    vi.stubGlobal("fetch", fetchMock);

    captureGuardEvent(makeEvent());
    await flushAuditPublishQueue();

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("rawPayload");
  });

  it("failure isolation: a Control Plane that's down never affects the verdict path (§8.1)", async () => {
    vi.stubGlobal("fetch", fetchMockRejecting("Control Plane unreachable"));
    // The actual production wiring (normally installed once at module load, guarded off under
    // NODE_ENV=test so tests can drive captureGuardEvent directly elsewhere in this file) — here
    // it's installed for real so this test also covers that one line.
    const unsubscribe = subscribeToGuardBus();

    try {
      const ctx: ToolCallContext = {
        direction: "request",
        toolName: "read_file",
        payload: JSON.stringify({ path: ".env" }),
        sessionId: "s-isolation",
        serverId: "demo-mcp-tools",
        serverTrust: "untrusted"
      };
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
      const deps: RouterDeps = { approvalBackend: new InMemoryApprovalBackend() };

      const routed = await routeByVerdict(ctx, decision, deps);

      expect(routed.verdict).toBe("block");
      await flushAuditPublishQueue();
      expect(auditPublisherMetrics().failed).toBe(1);
    } finally {
      unsubscribe();
    }
  });

  it("contract: the actual approval-resolved GuardEvent has every field the ingest DTO requires", async () => {
    // Guards against the two sides drifting apart: everywhere else in this file asserts against
    // a hand-built `makeEvent()` stand-in, which only proves the publisher forwards whatever
    // it's given — not that what the router actually emits matches what
    // AuditEventController.GuardEventIngestRequest (control-plane) expects. This drives a real
    // require_approval -> approve round trip through routeByVerdict (the same path
    // actionRouter.test.ts uses for "decidedBy/decidedAt") and inspects the real POST body.
    const fetchMock = fetchMockResolving(201);
    vi.stubGlobal("fetch", fetchMock);
    const unsubscribe = subscribeToGuardBus();

    try {
      const ctx: ToolCallContext = {
        direction: "request",
        toolName: "send_email",
        payload: JSON.stringify({ to: "partner@external.example" }),
        sessionId: "s-contract",
        serverId: "demo-mcp-tools",
        serverTrust: "untrusted"
      };
      const decision: PolicyDecision = {
        verdict: "require_approval",
        matchedPolicyIds: ["approve_external_email"],
        decidingPolicyId: "approve_external_email",
        riskScore: 88,
        severity: "high",
        reasonCode: "APPROVE_EXTERNAL_EMAIL",
        message: "waiting",
        detections: [{ type: "PII", subtype: "EMAIL", start: 0, end: 5, confidence: 0.8, maskedAs: "[EMAIL]" }],
        approval: { timeoutSeconds: 5, onTimeout: "block", allowMaskedApproval: false }
      };
      const deps: RouterDeps = {
        approvalBackend: {
          submit: async () => "req-1",
          awaitDecision: async () => ({ decision: "approve" })
        }
      };

      await routeByVerdict(ctx, decision, deps);
      await flushAuditPublishQueue();

      // Two guard.events publish: the pending require_approval, then the resolved allow.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
      const resolved = bodies.find((body) => body.verdict === "allow");
      expect(resolved).toBeDefined();

      // Everything AuditEventController.GuardEventIngestRequest (control-plane) requires.
      for (const field of ["eventId", "sessionId", "ts", "direction", "toolName", "argsDigest", "verdict", "riskScore"]) {
        expect(resolved).toHaveProperty(field);
      }
      // decidedBy/decidedAt aren't in that DTO at all — this pins that the router does send
      // them, so the DTO's reliance on Jackson's unknown-property tolerance (asserted from the
      // Kotlin side by AuditEventApiTest's "tolerates extra fields..." test) is exercised
      // against a real payload shape, not an assumed one.
      expect(resolved.decidedBy).toBe("approval-backend");
      expect(typeof resolved.decidedAt).toBe("string");
      expect(resolved.detections[0]).toMatchObject({
        type: "PII",
        subtype: "EMAIL",
        span: { start: 0, end: 5 },
        confidence: 0.8,
        maskedAs: "[EMAIL]"
      });
    } finally {
      unsubscribe();
    }
  });
});
