import { describe, expect, it } from "vitest";
import { createAutoExpireApprovalBackend, InMemoryApprovalBackend } from "./backend.js";

const baseRequest = {
  direction: "request" as const,
  toolName: "send_email",
  riskScore: 80,
  matchedPolicyIds: [],
  sessionId: "s-1",
  policyId: "approve_external_email_with_secret",
  message: "External transmission is waiting for human approval.",
  riskTags: [],
};

describe("InMemoryApprovalBackend", () => {
  it("settles with the decision passed to resolve() before the timeout", async () => {
    const backend = new InMemoryApprovalBackend();
    const id = await backend.submit({ ...baseRequest, eventRef: "evt-1" });
    const pending = backend.awaitDecision(id, 5_000);
    expect(backend.resolve(id, "approve_masked")).toBe(true);
    await expect(pending).resolves.toEqual({ decision: "approve_masked" });
  });

  it("expires unresolved requests once timeoutMs elapses", async () => {
    const backend = new InMemoryApprovalBackend();
    const id = await backend.submit({ ...baseRequest, eventRef: "evt-2" });
    await expect(backend.awaitDecision(id, 10)).resolves.toEqual({ decision: "expired" });
  });

  it("resolve() on an unknown or already-settled id is a no-op", async () => {
    const backend = new InMemoryApprovalBackend();
    expect(backend.resolve("never-submitted", "approve")).toBe(false);
    const id = await backend.submit({ ...baseRequest, eventRef: "evt-3" });
    await backend.awaitDecision(id, 10);
    expect(backend.resolve(id, "approve")).toBe(false);
  });
});

describe("createAutoExpireApprovalBackend", () => {
  it("expires immediately, regardless of timeoutMs, because no console can ever answer it", async () => {
    const backend = createAutoExpireApprovalBackend();
    const id = await backend.submit({ ...baseRequest, eventRef: "evt-4" });
    await expect(backend.awaitDecision(id, 120_000)).resolves.toEqual({ decision: "expired" });
  });
});
