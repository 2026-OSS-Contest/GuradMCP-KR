import { afterEach, describe, expect, it } from "vitest";
import { registerLlmAdapter, resetLlmAdapter, type AdjudicationRequest, type LlmAdapter } from "./adapter.js";
import { adjudicate, adjudicationEnabled, isBorderline } from "./adjudicator.js";

/** Never a real provider: the point of the seam is that the gateway needs none to be tested. */
function fakeAdapter(
  answer: Partial<{ label: unknown; confidence: unknown }> | (() => Promise<never>),
  name = "fake-model",
): LlmAdapter {
  return {
    name,
    classify: typeof answer === "function"
      ? (answer as unknown as LlmAdapter["classify"])
      : async () => answer as never,
  };
}

const enable = () => { process.env.LLM_ADJUDICATOR_ENABLED = "true"; };

afterEach(() => {
  delete process.env.LLM_ADJUDICATOR_ENABLED;
  resetLlmAdapter();
});

describe("optional LLM adjudicator (GMCP-57, FR-INJ-04)", () => {
  it("is off unless an operator both enables it and registers an adapter", async () => {
    expect(adjudicationEnabled()).toBe(false);
    expect(await adjudicate("보류 중인 요청", 50)).toBeNull();

    enable();
    // Enabled but nothing registered: still nothing to call.
    expect(adjudicationEnabled()).toBe(false);
    expect(await adjudicate("보류 중인 요청", 50)).toBeNull();

    registerLlmAdapter(fakeAdapter({ label: "benign", confidence: 1 }));
    expect(adjudicationEnabled()).toBe(true);
  });

  it("only spends a call on the borderline band", async () => {
    expect(isBorderline(39)).toBe(false);
    expect(isBorderline(40)).toBe(true);
    expect(isBorderline(69)).toBe(true);
    // At 70 the pipeline escalates on its own, so a second opinion changes nothing.
    expect(isBorderline(70)).toBe(false);

    enable();
    let calls = 0;
    registerLlmAdapter({ name: "counting", classify: async () => { calls += 1; return { label: "benign", confidence: 1 }; } });
    await adjudicate("무해한 문장", 10);
    await adjudicate("무해한 문장", 95);
    expect(calls).toBe(0);
    await adjudicate("경계 문장", 55);
    expect(calls).toBe(1);
  });

  it("escalates on a confident injection and records what it cost", async () => {
    enable();
    registerLlmAdapter(fakeAdapter({ label: "injection", confidence: 0.9 }, "gemma-test"));
    const record = await adjudicate("애매한 지시문", 55);
    expect(record).not.toBeNull();
    expect(record!.escalated).toBe(true);
    expect(record!.model).toBe("gemma-test");
    expect(record!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(record!.failure).toBeUndefined();
  });

  it("never softens the rule verdict", async () => {
    enable();
    // A model insisting the payload is fine must not be able to undo the rules.
    for (const answer of [{ label: "benign", confidence: 1 }, { label: "unsure", confidence: 1 }]) {
      registerLlmAdapter(fakeAdapter(answer));
      const record = await adjudicate("경계 문장", 55);
      expect(record!.escalated, JSON.stringify(answer)).toBe(false);
    }
    // Nor may a low-confidence accusation escalate on its own.
    registerLlmAdapter(fakeAdapter({ label: "injection", confidence: 0.4 }));
    expect((await adjudicate("경계 문장", 55))!.escalated).toBe(false);
  });

  it("records an adapter that fails instead of failing the request", async () => {
    enable();
    registerLlmAdapter(fakeAdapter(async () => { throw new Error("upstream refused"); }));
    const record = await adjudicate("경계 문장", 55);
    expect(record!.failure).toBe("error");
    expect(record!.escalated).toBe(false);
  });

  it("treats a malformed answer as no answer", async () => {
    enable();
    registerLlmAdapter(fakeAdapter({ label: "definitely-bad", confidence: 12 }));
    const record = await adjudicate("경계 문장", 55);
    expect(record!.failure).toBe("malformed");
    expect(record!.escalated).toBe(false);
  });

  it("gives up on an adapter that hangs, and says so", async () => {
    enable();
    registerLlmAdapter({
      name: "hanging",
      classify: ({ signal }: AdjudicationRequest) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    const record = await adjudicate("경계 문장", 55);
    expect(record!.failure).toBe("timeout");
    expect(record!.escalated).toBe(false);
  }, 10_000);
});
