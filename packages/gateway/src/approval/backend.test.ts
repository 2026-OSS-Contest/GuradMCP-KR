import { describe, expect, it } from "vitest";
import { createAutoExpireApprovalBackend, InMemoryApprovalBackend } from "./backend.js";

describe("InMemoryApprovalBackend", () => {
  it("settles with the decision passed to resolve() before the timeout", async () => {
    const backend = new InMemoryApprovalBackend();
    const id = await backend.submit({ eventRef: "evt-1", direction: "request", toolName: "send_email", riskScore: 80, matchedPolicyIds: [] });
    const pending = backend.awaitDecision(id, 5_000);
    expect(backend.resolve(id, "approve_masked")).toBe(true);
    await expect(pending).resolves.toBe("approve_masked");
  });

  it("expires unresolved requests once timeoutMs elapses", async () => {
    const backend = new InMemoryApprovalBackend();
    const id = await backend.submit({ eventRef: "evt-2", direction: "request", toolName: "send_email", riskScore: 80, matchedPolicyIds: [] });
    await expect(backend.awaitDecision(id, 10)).resolves.toBe("expired");
  });

  it("resolve() on an unknown or already-settled id is a no-op", async () => {
    const backend = new InMemoryApprovalBackend();
    expect(backend.resolve("never-submitted", "approve")).toBe(false);
    const id = await backend.submit({ eventRef: "evt-3", direction: "request", toolName: "send_email", riskScore: 80, matchedPolicyIds: [] });
    await backend.awaitDecision(id, 10);
    expect(backend.resolve(id, "approve")).toBe(false);
  });
});

describe("createAutoExpireApprovalBackend", () => {
  it("expires immediately, regardless of timeoutMs, because no console can ever answer it", async () => {
    const backend = createAutoExpireApprovalBackend();
    const id = await backend.submit({ eventRef: "evt-4", direction: "request", toolName: "send_email", riskScore: 80, matchedPolicyIds: [] });
    await expect(backend.awaitDecision(id, 120_000)).resolves.toBe("expired");
  });
});
