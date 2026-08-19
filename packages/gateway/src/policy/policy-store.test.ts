// FR-POL-03 §4.3: atomic reference-swap semantics.
import { describe, expect, it } from "vitest";
import type { PackRegistry } from "@guardmcp/policy-engine";
import { PolicyStore, type PolicySnapshot } from "./policy-store.js";

function snapshot(version: string): PolicySnapshot {
  return { registry: {} as PackRegistry, version, loadedAt: new Date() };
}

describe("PolicyStore", () => {
  it("returns the snapshot it was constructed with", () => {
    const initial = snapshot("1");
    const store = new PolicyStore(initial);

    expect(store.getSnapshot()).toBe(initial);
  });

  it("swap() replaces the snapshot future getSnapshot() calls observe", () => {
    const store = new PolicyStore(snapshot("1"));
    const next = snapshot("2");

    store.swap(next);

    expect(store.getSnapshot()).toBe(next);
  });

  it("a snapshot reference captured before swap() is unaffected by it (in-flight evaluation consistency)", () => {
    const store = new PolicyStore(snapshot("1"));

    // Simulates evaluatePayloadOrThrow reading the snapshot once at the top of a request.
    const capturedDuringEvaluation = store.getSnapshot();

    store.swap(snapshot("2"));

    expect(capturedDuringEvaluation.version).toBe("1");
    expect(store.getSnapshot().version).toBe("2");
  });
});
