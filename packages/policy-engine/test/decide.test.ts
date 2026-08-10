import { describe, expect, it } from "vitest";
import { decide } from "../src/decide.js";
import type { Action, DecisionInput, Policy } from "../src/index.js";
import { actions } from "../src/index.js";

// Permissive base event; each test overrides only the fields it exercises.
function input(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    event: { direction: "request", toolName: "read_file", serverTrust: "untrusted", args: {} },
    detections: [],
    riskScore: 0,
    activePolicies: [],
    ...overrides
  };
}

function policy(overrides: Partial<Policy> & Pick<Policy, "id" | "priority" | "action">): Policy {
  return {
    pack: "test",
    match: {},
    severity: "medium",
    ...overrides
  };
}

// --- §7.1 priority ascending evaluation -------------------------------------

it("evaluates in priority-ascending order and records matches in that order", () => {
  const result = decide(
    input({
      // Deliberately supplied out of priority order, so a passing assertion
      // proves decide() sorts rather than merely preserving array order.
      activePolicies: [
        policy({ id: "high_priority_second", priority: 200, action: "warn" }),
        policy({ id: "low_priority_first", priority: 10, action: "warn" })
      ]
    })
  );
  expect(result.matchedPolicyIds).toEqual(["low_priority_first", "high_priority_second"]);
});

// --- §7.2 severity-max default strategy -------------------------------------

it("adopts block over warn under the default severity-max strategy", () => {
  const result = decide(
    input({
      activePolicies: [
        policy({ id: "warn_policy", priority: 100, action: "warn" }),
        policy({ id: "block_policy", priority: 200, action: "block" })
      ]
    })
  );
  expect(result.verdict).toBe("block");
  expect(result.decidingPolicyId).toBe("block_policy");
});

describe("severity-max rank ordering (block > require_approval > warn > mask_then_allow > allow)", () => {
  const rankOrder: Action[] = ["allow", "mask_then_allow", "warn", "require_approval", "block"];

  for (let weaker = 0; weaker < rankOrder.length; weaker += 1) {
    for (let stronger = weaker + 1; stronger < rankOrder.length; stronger += 1) {
      const weakerAction = rankOrder[weaker]!;
      const strongerAction = rankOrder[stronger]!;
      it(`${strongerAction} beats ${weakerAction}`, () => {
        const result = decide(
          input({
            activePolicies: [
              policy({ id: "weaker", priority: 100, action: weakerAction }),
              policy({ id: "stronger", priority: 200, action: strongerAction })
            ]
          })
        );
        expect(result.verdict).toBe(strongerAction);
        expect(result.decidingPolicyId).toBe("stronger");
      });
    }
  }

  it("covers every declared action in the rank table", () => {
    expect(new Set(rankOrder)).toEqual(new Set(actions));
  });
});

// --- §7.3 unmatched -> default_action ---------------------------------------

describe("no policy matches", () => {
  it("falls back to defaultAction (allow by default)", () => {
    const result = decide(input());
    expect(result.verdict).toBe("allow");
    expect(result.matchedPolicyIds).toEqual([]);
    expect(result.decidingPolicyId).toBeNull();
  });

  it("honors an explicit defaultAction", () => {
    const result = decide(input({ defaultAction: "warn" }));
    expect(result.verdict).toBe("warn");
  });

  it("resolves to warn under strictMode when no defaultAction is given", () => {
    const result = decide(input({ strictMode: true }));
    expect(result.verdict).toBe("warn");
  });

  // GMCP-75 §4.3/§7 규칙 3: explicit default_action always wins, even under
  // strict mode. This supersedes the pre-GMCP-75 behavior where strictMode
  // unconditionally forced warn.
  it("honors an explicit defaultAction even under strictMode", () => {
    const result = decide(input({ strictMode: true, defaultAction: "block" }));
    expect(result.verdict).toBe("block");
  });
});

// --- §7.4 mask_then_allow ----------------------------------------------------

it("returns mask_then_allow as the verdict when it is the strongest match", () => {
  const result = decide(
    input({
      activePolicies: [policy({ id: "mask_pii", priority: 100, action: "mask_then_allow" })]
    })
  );
  expect(result.verdict).toBe("mask_then_allow");
  expect(result.decidingPolicyId).toBe("mask_pii");
});

// --- §7.5 matchedPolicyIds records every match ------------------------------

it("records every matched policy id under severity-max even though one policy decides the verdict", () => {
  const result = decide(
    input({
      activePolicies: [
        policy({ id: "p1_allow", priority: 10, action: "allow" }),
        policy({ id: "p2_block", priority: 20, action: "block" }),
        policy({ id: "p3_warn", priority: 30, action: "warn" })
      ]
    })
  );
  expect(result.verdict).toBe("block");
  expect(result.decidingPolicyId).toBe("p2_block");
  expect(result.matchedPolicyIds).toEqual(["p1_allow", "p2_block", "p3_warn"]);
});

// GMCP-75 §3 규칙 5: matchedPolicyIds has no first-match exception. Only
// action adoption short-circuits at the first match; matches after it are
// still recorded. This supersedes the pre-GMCP-75 behavior where evaluation
// stopped entirely at the break point.
it("adopts the first match's action but still records later matches under first-match", () => {
  const result = decide(
    input({
      strategy: "first-match",
      activePolicies: [
        policy({ id: "p1_allow", priority: 10, action: "allow" }),
        policy({ id: "p2_block", priority: 20, action: "block" }),
        policy({ id: "p3_warn", priority: 30, action: "warn" })
      ]
    })
  );
  expect(result.verdict).toBe("allow");
  expect(result.decidingPolicyId).toBe("p1_allow");
  expect(result.matchedPolicyIds).toEqual(["p1_allow", "p2_block", "p3_warn"]);
});

// --- Recommended additional coverage -----------------------------------------

it("diverges between first-match and severity-max when a low-priority warn precedes a high-priority block", () => {
  const activePolicies = [
    policy({ id: "warn_first", priority: 10, action: "warn" }),
    policy({ id: "block_second", priority: 200, action: "block" })
  ];
  expect(decide(input({ strategy: "first-match", activePolicies })).verdict).toBe("warn");
  expect(decide(input({ strategy: "severity-max", activePolicies })).verdict).toBe("block");
});

it("tie-breaks equal-rank matches toward the lower-priority (earlier-evaluated) policy", () => {
  const result = decide(
    input({
      // Supplied with the later-priority (higher-number) policy first, so a
      // naive "first element in the input array wins ties" implementation
      // would pick block_later instead of the spec-mandated block_earlier.
      activePolicies: [
        policy({ id: "block_later", priority: 20, action: "block" }),
        policy({ id: "block_earlier", priority: 10, action: "block" })
      ]
    })
  );
  expect(result.decidingPolicyId).toBe("block_earlier");
  expect(result.matchedPolicyIds).toEqual(["block_earlier", "block_later"]);
});

it("excludes disabled policies from matching", () => {
  const result = decide(
    input({
      activePolicies: [policy({ id: "disabled_block", priority: 10, action: "block", enabled: false })]
    })
  );
  expect(result.verdict).toBe("allow");
  expect(result.matchedPolicyIds).toEqual([]);
});

it("resolves via defaultAction when no policies are active at all", () => {
  const result = decide(input({ activePolicies: [], defaultAction: "warn" }));
  expect(result.verdict).toBe("warn");
  expect(result.matchedPolicyIds).toEqual([]);
  expect(result.decidingPolicyId).toBeNull();
});

// --- event -> match-context field mapping ------------------------------------

it("maps event.toolName/serverTrust and top-level detections/riskScore onto the match context", () => {
  const guardedPolicy = policy({
    id: "guarded_write",
    priority: 10,
    action: "block",
    match: { tool: "write_file", server_trust: "untrusted", detections: { any_of: ["SECRET"] }, risk_score: { gte: 70 } }
  });

  const matching = decide(
    input({
      event: { direction: "request", toolName: "write_file", serverTrust: "untrusted", args: {} },
      detections: [{ type: "SECRET", subtype: "API_KEY" }],
      riskScore: 80,
      activePolicies: [guardedPolicy]
    })
  );
  expect(matching.verdict).toBe("block");
  expect(matching.matchedPolicyIds).toEqual(["guarded_write"]);

  // Same policy, but event.toolName doesn't satisfy match.tool -> no match.
  const nonMatching = decide(
    input({
      event: { direction: "request", toolName: "read_file", serverTrust: "untrusted", args: {} },
      detections: [{ type: "SECRET", subtype: "API_KEY" }],
      riskScore: 80,
      activePolicies: [guardedPolicy]
    })
  );
  expect(nonMatching.verdict).toBe("allow");
  expect(nonMatching.matchedPolicyIds).toEqual([]);
});

// --- GuardEvent contract mapping (§4.2) --------------------------------------

it("maps directly onto GuardEvent.verdict / GuardEvent.matchedPolicyIds, in priority order, for a mid-list decider", () => {
  const result = decide(
    input({
      activePolicies: [
        policy({ id: "p1_allow", priority: 10, action: "allow" }),
        policy({ id: "p2_require_approval", priority: 20, action: "require_approval" }),
        policy({ id: "p3_warn", priority: 30, action: "warn" })
      ]
    })
  );
  const guardEvent = { verdict: result.verdict, matchedPolicyIds: result.matchedPolicyIds };
  expect(guardEvent).toEqual({
    verdict: "require_approval",
    matchedPolicyIds: ["p1_allow", "p2_require_approval", "p3_warn"]
  });
});
