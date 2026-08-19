// SPEC-POL-04 (GMCP-77): dry-run mode + FPR pre-measurement.
//
// Covers §3.1 (DSL field survives the real YAML loader, not just a hand-built `Policy`
// object — see types.ts's `dry_run` doc comment for why that distinction matters), §3.2
// (actionable/shadow split + wouldEscalate) across all three live evaluators
// (`evaluatePolicies`, `evaluate`, `decide`), and §8.1's zero-side-effect scenarios at the
// policy-engine layer (T-DR-01/02/04/05; the approval-queue/masking non-side-effects
// themselves, T-DR-02/03, are gateway-layer concerns covered in packages/gateway).
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPolicyPacks } from "../src/loader/packRegistry.js";
import { evaluatePolicies } from "../src/evaluate.js";
import { evaluate } from "../src/index.js";
import { decide } from "../src/decide.js";
import type { Policy, PolicyContext, PolicyPackConfig } from "../src/types.js";

const fixturesRoot = fileURLToPath(new URL("./fixtures", import.meta.url));

function context(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    direction: "request",
    tool: "read_file",
    serverTrust: "untrusted",
    args: {},
    detections: [],
    riskScore: 0,
    ...overrides
  };
}

function pack(overrides: Partial<PolicyPackConfig> = {}): PolicyPackConfig {
  return { name: "test-pack", strategy: "severity-max", rules: [], ...overrides };
}

function policy(overrides: Partial<Policy> & Pick<Policy, "id" | "priority" | "action">): Policy {
  return { pack: "test", match: {}, severity: "medium", ...overrides };
}

describe("dry_run DSL loading (§3.1)", () => {
  it("survives the real YAML -> Policy loader verbatim, including pack-level default_dry_run inheritance and override", async () => {
    const registry = await loadPolicyPacks(`${fixturesRoot}/dry-run-root`, { requiredPacks: [] });
    const loaded = registry.getPack("dry-run-pack");
    expect(loaded?.errors).toEqual([]);
    const byId = new Map(loaded?.policies.map((p) => [p.id, p]));

    expect(byId.get("explicit_dry_run_block")?.dry_run).toBe(true);
    // No dry_run key of its own -> inherits the pack manifest's default_dry_run: true.
    expect(byId.get("inherited_dry_run_warn")?.dry_run).toBe(true);
    // Explicit dry_run: false always wins over the inherited pack default.
    expect(byId.get("opted_out_block")?.dry_run).toBe(false);
  });
});

describe("evaluatePolicies() actionable/shadow split (§3.2, decide()'s canonical path)", () => {
  it("T-DR-04: actionable allow + shadow block -> real verdict allow, virtualVerdict block, wouldEscalate true", () => {
    const rules = [
      policy({ id: "allow_rest", priority: 10, action: "allow" }),
      policy({ id: "shadow_block", priority: 20, action: "block", severity: "critical", dry_run: true })
    ];
    const result = evaluatePolicies(rules, context(), pack());
    expect(result.action).toBe("allow");
    expect(result.matchedPolicyIds).toEqual(["allow_rest"]);
    expect(result.dryRunMatchedPolicyIds).toEqual(["shadow_block"]);
    expect(result.virtualVerdict).toEqual({ action: "block", severity: "critical" });
    expect(result.wouldEscalate).toBe(true);
  });

  it("T-DR-01 shape: shadow-only match (no actionable policy at all) resolves to default_action, not the shadow action", () => {
    const rules = [policy({ id: "shadow_block", priority: 10, action: "block", dry_run: true })];
    const result = evaluatePolicies(rules, context(), pack());
    expect(result.action).toBe("allow"); // pack default_action
    expect(result.usedDefault).toBe(true);
    expect(result.winningPolicyId).toBeNull();
    expect(result.matchedPolicyIds).toEqual([]);
    expect(result.dryRunMatchedPolicyIds).toEqual(["shadow_block"]);
    expect(result.virtualVerdict?.action).toBe("block");
    expect(result.wouldEscalate).toBe(true);
  });

  it("actionable block + shadow block -> wouldEscalate is false (shadow doesn't outrank an already-maximal real verdict)", () => {
    const rules = [
      policy({ id: "actionable_block", priority: 10, action: "block", severity: "high" }),
      policy({ id: "shadow_block", priority: 20, action: "block", severity: "critical", dry_run: true })
    ];
    const result = evaluatePolicies(rules, context(), pack());
    expect(result.action).toBe("block");
    expect(result.winningPolicyId).toBe("actionable_block");
    expect(result.wouldEscalate).toBe(false);
  });

  it("shadow group's virtual verdict is severity-max even when the pack strategy is first-match", () => {
    const rules = [
      policy({ id: "shadow_warn", priority: 10, action: "warn", severity: "low", dry_run: true }),
      policy({ id: "shadow_block", priority: 20, action: "block", severity: "critical", dry_run: true })
    ];
    const result = evaluatePolicies(rules, context(), pack({ strategy: "first-match" }));
    expect(result.action).toBe("allow");
    expect(result.virtualVerdict).toEqual({ action: "block", severity: "critical" });
  });

  it("T-DR-05 shape: mode 'shadow-all' forces every match into shadow regardless of its own dry_run value", () => {
    const rules = [policy({ id: "would_be_actionable_block", priority: 10, action: "block" })];
    const result = evaluatePolicies(rules, context(), pack(), "shadow-all");
    expect(result.action).toBe("allow");
    expect(result.usedDefault).toBe(true);
    expect(result.dryRunMatchedPolicyIds).toEqual(["would_be_actionable_block"]);
    expect(result.virtualVerdict?.action).toBe("block");
  });

  it("no dry_run policies anywhere -> identical to pre-GMCP-77 behavior (virtualVerdict null, wouldEscalate false)", () => {
    const rules = [
      policy({ id: "p1", priority: 10, action: "allow" }),
      policy({ id: "p2", priority: 20, action: "block" })
    ];
    const result = evaluatePolicies(rules, context(), pack());
    expect(result.action).toBe("block");
    expect(result.matchedPolicyIds).toEqual(["p1", "p2"]);
    expect(result.virtualVerdict).toBeNull();
    expect(result.wouldEscalate).toBe(false);
  });
});

describe("evaluate() (index.ts) — the function the live gateway actually calls", () => {
  it("never lets a shadow policy decide `action`, and reports it separately as dryRunAction", () => {
    const policies: Policy[] = [
      { id: "allow_rest", pack: "p", priority: 10, match: {}, action: "allow", severity: "medium" },
      {
        id: "shadow_mask",
        pack: "p",
        priority: 20,
        match: {},
        action: "mask_then_allow",
        severity: "high",
        dry_run: true
      }
    ];
    const result = evaluate(policies, context());
    expect(result.action).toBe("allow");
    expect(result.matchedPolicyIds).toEqual(["allow_rest"]);
    // §2.1 zero-side-effect: the shadow policy must not appear in `policies` either, since
    // server.ts's toPolicyDecision sources severity/message/reasonCode from that list.
    expect(result.policies.map((p) => p.id)).toEqual(["allow_rest"]);
    expect(result.dryRunAction).toBe("mask_then_allow");
    expect(result.dryRunMatchedPolicyIds).toEqual(["shadow_mask"]);
    expect(result.dryRunPolicies.map((p) => p.id)).toEqual(["shadow_mask"]);
    expect(result.wouldEscalate).toBe(true);
  });

  it("shadow-only match resolves action to defaultAction, e.g. a dry_run block on an otherwise-unmatched call stays allow", () => {
    const policies: Policy[] = [
      { id: "shadow_block", pack: "p", priority: 10, match: {}, action: "block", severity: "critical", dry_run: true }
    ];
    const result = evaluate(policies, context(), "allow");
    expect(result.action).toBe("allow");
    expect(result.policies).toEqual([]);
    expect(result.dryRunAction).toBe("block");
  });

  it("mode 'shadow-all' is a caller-supplied parameter only — no field on Policy or PolicyContext can turn it on", () => {
    const policies: Policy[] = [
      { id: "would_block", pack: "p", priority: 10, match: {}, action: "block", severity: "critical" }
    ];
    expect(evaluate(policies, context()).action).toBe("block");
    expect(evaluate(policies, context(), "allow", "severity-max", "shadow-all").action).toBe("allow");
  });
});

describe("decide() (GMCP-12 adapter) surfaces dryRunVerdict/dryRunMatchedPolicyIds/wouldEscalate", () => {
  it("maps evaluatePolicies()'s shadow fields onto DecisionResult", () => {
    const result = decide({
      event: { direction: "request", toolName: "read_file", serverTrust: "untrusted", args: {} },
      detections: [],
      riskScore: 0,
      activePolicies: [
        policy({ id: "allow_rest", priority: 10, action: "allow" }),
        policy({ id: "shadow_block", priority: 20, action: "block", severity: "critical", dry_run: true })
      ]
    });
    expect(result.verdict).toBe("allow");
    expect(result.matchedPolicyIds).toEqual(["allow_rest"]);
    expect(result.dryRunVerdict).toBe("block");
    expect(result.dryRunMatchedPolicyIds).toEqual(["shadow_block"]);
    expect(result.wouldEscalate).toBe(true);
  });

  it("reports dryRunVerdict null when nothing shadow-matched", () => {
    const result = decide({
      event: { direction: "request", toolName: "read_file", serverTrust: "untrusted", args: {} },
      detections: [],
      riskScore: 0,
      activePolicies: [policy({ id: "allow_rest", priority: 10, action: "allow" })]
    });
    expect(result.dryRunVerdict).toBeNull();
    expect(result.dryRunMatchedPolicyIds).toEqual([]);
    expect(result.wouldEscalate).toBe(false);
  });
});
