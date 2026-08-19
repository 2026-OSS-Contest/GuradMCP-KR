import { describe, expect, it } from "vitest";
import { readDryRunObservations } from "./dryRunStats.js";
import type { Policy } from "../../packages/policy-engine/src/index.js";

const policies = [{ id: "mask_korean_pii_response" }, { id: "block_env_file_read" }] as Policy[];

/** Answers the shipped `PolicyStatsResponse` shape; never a real control plane. */
function stubFetch(byPolicy: Record<string, number>, status = 200): typeof fetch {
  return (async (url: string | URL) => {
    const policyId = decodeURIComponent(String(url).split("/policies/")[1]!.split("/")[0]!);
    if (status !== 200) return { ok: false, status, json: async () => ({}) } as Response;
    return {
      ok: true,
      status: 200,
      json: async () => ({ policyId, window: "30d", firedLast30d: byPolicy[policyId] ?? 0, lastTriggeredAt: null }),
    } as Response;
  }) as unknown as typeof fetch;
}

describe("dry-run observations (GMCP-31, FR-LAB-03)", () => {
  it("reports absence when no control plane is configured", async () => {
    const result = await readDryRunObservations(policies, undefined);
    expect(result.available).toBe(false);
  });

  it("reports absence rather than zero when the counts alone cannot say", async () => {
    // "No policy fired" and "nothing was observed" are the same JSON and opposite claims,
    // and a judge-facing report must not conflate them.
    const result = await readDryRunObservations(policies, "http://control-plane:8080", stubFetch({}));
    expect(result.available).toBe(false);
    expect(result.available === false && result.reason).toMatch(/cannot be told apart/);
  });

  it("does not blame the absence on a cause it cannot check", async () => {
    // The previous wording asserted "no policy is running in dry-run yet". That is true
    // today and becomes false the moment GMCP-77 turns dry-run on with a clean period —
    // at which point a real "zero false positives" result would be reported as nothing
    // having been measured. The reason may describe what is missing, not why (GMCP-118).
    const result = await readDryRunObservations(policies, "http://control-plane:8080", stubFetch({}));
    expect(result.available === false && result.reason).not.toMatch(/no policy is running/);
  });

  it("reports a clean dry-run period as observed once the contract says so", async () => {
    // Zero fires *and* an explicit dry-run signal is a measurement: policies were running
    // and nothing misfired. This is the case the old count heuristic silently discarded.
    const withSignal: typeof fetch = (async (url: string | URL) => {
      const policyId = decodeURIComponent(String(url).split("/policies/")[1]!.split("/")[0]!);
      return {
        ok: true,
        status: 200,
        json: async () => ({ policyId, window: "30d", firedLast30d: 0, lastTriggeredAt: null, dryRun: true }),
      } as Response;
    }) as unknown as typeof fetch;

    const result = await readDryRunObservations(policies, "http://control-plane:8080", withSignal);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.totalFired).toBe(0);
    expect(result.policies).toHaveLength(policies.length);
  });

  it("reports observed activity once a policy actually runs in dry-run", async () => {
    const result = await readDryRunObservations(
      policies,
      "http://control-plane:8080",
      stubFetch({ mask_korean_pii_response: 4, block_env_file_read: 2 }),
    );
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.totalFired).toBe(6);
    expect(result.policies.map(({ policyId }) => policyId)).toContain("block_env_file_read");
  });

  it("never turns fire counts into a false-positive rate", async () => {
    const result = await readDryRunObservations(
      policies,
      "http://control-plane:8080",
      stubFetch({ mask_korean_pii_response: 4 }),
    );
    // The endpoint supplies a numerator only. An FPR needs how much benign traffic passed,
    // which no shipped endpoint reports, so this must not invent one.
    expect(JSON.stringify(result)).not.toMatch(/fpr|rate/i);
  });

  it("degrades to absence when the control plane errors, rather than failing the run", async () => {
    const result = await readDryRunObservations(policies, "http://control-plane:8080", stubFetch({}, 503));
    expect(result.available).toBe(false);
    expect(result.available === false && result.reason).toMatch(/503/);
  });

  it("degrades to absence when the control plane is unreachable", async () => {
    const failing = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const result = await readDryRunObservations(policies, "http://control-plane:8080", failing);
    expect(result.available).toBe(false);
    expect(result.available === false && result.reason).toMatch(/unreachable/);
  });
});
