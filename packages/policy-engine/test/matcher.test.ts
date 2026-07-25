import { describe, expect, it } from "vitest";
import {
  matchArgs,
  matchDetections,
  matchDirection,
  matchesPolicy,
  matchRiskScore,
  matchServerTrust,
  matchTool
} from "../src/matcher.js";
import type { Detection, Policy, PolicyContext } from "../src/index.js";

// A permissive base context; each test overrides only the fields it exercises.
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

// --- 7.1 Appendix A integration tests --------------------------------------

describe("block_env_file_read (Appendix A.1)", () => {
  const policy: Policy = {
    id: "block_env_file_read",
    pack: "default",
    priority: 100,
    match: {
      direction: "request",
      tool: "read_file",
      server_trust: "any",
      args: { path_regex: "(^|/)(\\.env(\\..*)?|id_rsa|credentials(\\.json)?)$" }
    },
    action: "block",
    severity: "critical"
  };

  it("matches read_file(.env)", () => {
    expect(matchesPolicy(policy, context({ args: { path: ".env" } }))).toBe(true);
  });

  it("matches read_file(config/credentials.json)", () => {
    expect(matchesPolicy(policy, context({ args: { path: "config/credentials.json" } }))).toBe(true);
  });

  it("matches read_file(~/.ssh/id_rsa)", () => {
    expect(matchesPolicy(policy, context({ args: { path: "~/.ssh/id_rsa" } }))).toBe(true);
  });

  it("does not match read_file(readme.md) — path_regex miss", () => {
    expect(matchesPolicy(policy, context({ args: { path: "readme.md" } }))).toBe(false);
  });

  it("does not match write_file(.env) — tool is an exact field, not glob", () => {
    expect(matchesPolicy(policy, context({ tool: "write_file", args: { path: ".env" } }))).toBe(false);
  });

  it("does not match the same call in the response direction", () => {
    expect(matchesPolicy(policy, context({ direction: "response", args: { path: ".env" } }))).toBe(false);
  });
});

describe("approve_external_email_with_secret (Appendix A.2)", () => {
  const policy: Policy = {
    id: "approve_external_email_with_secret",
    pack: "default",
    priority: 200,
    match: {
      direction: "request",
      tool: "send_email",
      args: { to_not_domain: ["company.co.kr"] },
      detections: { any_of: ["SECRET", "PII.RRN_LIKE"] },
      risk_score: { gte: 70 }
    },
    action: "require_approval",
    severity: "high"
  };

  const secret: Detection[] = [{ type: "SECRET" }];

  it("matches external recipient + SECRET + risk 82", () => {
    expect(
      matchesPolicy(
        policy,
        context({ tool: "send_email", args: { to: "attacker@gmail.com" }, detections: secret, riskScore: 82 })
      )
    ).toBe(true);
  });

  it("does not match an internal recipient (to_not_domain unsatisfied)", () => {
    expect(
      matchesPolicy(
        policy,
        context({ tool: "send_email", args: { to: "a@company.co.kr" }, detections: secret, riskScore: 90 })
      )
    ).toBe(false);
  });

  it("does not match when only PII.PHONE is detected (detections.any_of unsatisfied)", () => {
    expect(
      matchesPolicy(
        policy,
        context({
          tool: "send_email",
          args: { to: "a@gmail.com" },
          detections: [{ type: "PII", subtype: "PHONE" }],
          riskScore: 80
        })
      )
    ).toBe(false);
  });

  it("does not match when risk 65 is below the gte threshold", () => {
    expect(
      matchesPolicy(
        policy,
        context({ tool: "send_email", args: { to: "a@gmail.com" }, detections: secret, riskScore: 65 })
      )
    ).toBe(false);
  });
});

// --- 7.2 Per-condition unit tests ------------------------------------------

describe("matchDirection", () => {
  it("matches request vs request", () => {
    expect(matchDirection("request", context({ direction: "request" }))).toBe(true);
  });
  it("does not match request vs response", () => {
    expect(matchDirection("request", context({ direction: "response" }))).toBe(false);
  });
  it("`any` always matches", () => {
    expect(matchDirection("any", context({ direction: "response" }))).toBe(true);
  });
  it("an omitted field always matches", () => {
    expect(matchDirection(undefined, context({ direction: "response" }))).toBe(true);
  });
});

describe("matchTool", () => {
  it("matches an exact tool name", () => {
    expect(matchTool("read_file", context({ tool: "read_file" }))).toBe(true);
  });
  it("does not match a different exact name", () => {
    expect(matchTool("read_file", context({ tool: "write_file" }))).toBe(false);
  });
  it("matches a glob (read_* ↔ read_file)", () => {
    expect(matchTool("read_*", context({ tool: "read_file" }))).toBe(true);
  });
  it("does not match a glob miss (read_* ↔ write_file)", () => {
    expect(matchTool("read_*", context({ tool: "write_file" }))).toBe(false);
  });
  it("anchors exact names so read_file does not match read_file_v2", () => {
    expect(matchTool("read_file", context({ tool: "read_file_v2" }))).toBe(false);
  });
  it("an omitted field always matches", () => {
    expect(matchTool(undefined, context({ tool: "anything" }))).toBe(true);
  });
});

describe("matchServerTrust", () => {
  it.each(["trusted", "limited", "untrusted"] as const)("matches %s against itself", (trust) => {
    expect(matchServerTrust(trust, context({ serverTrust: trust }))).toBe(true);
  });
  it("does not match trusted against untrusted", () => {
    expect(matchServerTrust("trusted", context({ serverTrust: "untrusted" }))).toBe(false);
  });
  it("`any` always matches", () => {
    expect(matchServerTrust("any", context({ serverTrust: "untrusted" }))).toBe(true);
  });
});

describe("matchArgs — path_regex", () => {
  const cond = { path_regex: "(^|/)(\\.env(\\..*)?|id_rsa)$" };
  it("matches when the path field satisfies the regex", () => {
    expect(matchArgs(cond, context({ args: { path: "app/.env" } }))).toBe(true);
  });
  it("does not match an unrelated path", () => {
    expect(matchArgs(cond, context({ args: { path: "readme.md" } }))).toBe(false);
  });
  it("does not match when no path-like field is present", () => {
    expect(matchArgs(cond, context({ args: { note: ".env" } }))).toBe(false);
  });
  it("matches a variant like .env.local", () => {
    expect(matchArgs(cond, context({ args: { path: "config/.env.local" } }))).toBe(true);
  });
  it("falls back to file_path then filename (spec §5.3)", () => {
    expect(matchArgs(cond, context({ args: { file_path: ".env" } }))).toBe(true);
    expect(matchArgs(cond, context({ args: { filename: "id_rsa" } }))).toBe(true);
  });
});

describe("matchArgs — to_not_domain", () => {
  const cond = { to_not_domain: ["company.co.kr"] };
  it("matches a recipient outside the list", () => {
    expect(matchArgs(cond, context({ args: { to: "user@gmail.com" } }))).toBe(true);
  });
  it("does not match a recipient inside the list", () => {
    expect(matchArgs(cond, context({ args: { to: "user@company.co.kr" } }))).toBe(false);
  });
  it("compares domains case-insensitively", () => {
    expect(matchArgs(cond, context({ args: { to: "user@COMPANY.CO.KR" } }))).toBe(false);
  });
  it("does not match when the to field is absent", () => {
    expect(matchArgs(cond, context({ args: {} }))).toBe(false);
  });
});

describe("matchDetections", () => {
  it("matches when the intersection is non-empty", () => {
    expect(
      matchDetections({ any_of: ["SECRET", "PII.RRN_LIKE"] }, context({ detections: [{ type: "SECRET" }] }))
    ).toBe(true);
  });
  it("does not match when the intersection is empty", () => {
    expect(
      matchDetections(
        { any_of: ["SECRET", "PII.RRN_LIKE"] },
        context({ detections: [{ type: "PII", subtype: "PHONE" }] })
      )
    ).toBe(false);
  });
  it("does not match against an empty detection list", () => {
    expect(matchDetections({ any_of: ["SECRET"] }, context({ detections: [] }))).toBe(false);
  });
  it("treats an empty any_of defensively as no match (spec §5.5)", () => {
    expect(matchDetections({ any_of: [] }, context({ detections: [{ type: "SECRET" }] }))).toBe(false);
  });
});

describe("matchRiskScore", () => {
  it("matches when the score exceeds the threshold", () => {
    expect(matchRiskScore({ gte: 70 }, context({ riskScore: 71 }))).toBe(true);
  });
  it("matches when the score equals the threshold", () => {
    expect(matchRiskScore({ gte: 70 }, context({ riskScore: 70 }))).toBe(true);
  });
  it("does not match when the score is below the threshold", () => {
    expect(matchRiskScore({ gte: 70 }, context({ riskScore: 69 }))).toBe(false);
  });
});

describe("composite AND boundary", () => {
  const policy: Policy = {
    id: "composite",
    pack: "test",
    priority: 1,
    match: {
      direction: "request",
      tool: "send_*",
      server_trust: "limited",
      args: { to_not_domain: ["company.co.kr"] },
      detections: { any_of: ["SECRET"] },
      risk_score: { gte: 70 }
    },
    action: "block",
    severity: "high"
  };
  const passing = context({
    direction: "request",
    tool: "send_email",
    serverTrust: "limited",
    args: { to: "attacker@gmail.com" },
    detections: [{ type: "SECRET" }],
    riskScore: 90
  });

  it("matches when every condition is satisfied", () => {
    expect(matchesPolicy(policy, passing)).toBe(true);
  });

  it.each([
    ["direction", { direction: "response" as const }],
    ["tool", { tool: "read_file" }],
    ["server_trust", { serverTrust: "trusted" as const }],
    ["to_not_domain", { args: { to: "a@company.co.kr" } }],
    ["detections", { detections: [{ type: "PII", subtype: "PHONE" }] }],
    ["risk_score", { riskScore: 50 }]
  ])("does not match when %s alone is off", (_label, override) => {
    expect(matchesPolicy(policy, { ...passing, ...override })).toBe(false);
  });
});

// --- 7.3 Regression guards -------------------------------------------------

describe("glob regression guards", () => {
  it("escapes regex metacharacters so a glob cannot be injected", () => {
    // A literal dot must stay literal, not act as a regex wildcard.
    expect(matchTool("read.file", context({ tool: "read.file" }))).toBe(true);
    expect(matchTool("read.file", context({ tool: "readXfile" }))).toBe(false);
  });

  it("an exact pattern never over-matches an adversarial tool name", () => {
    expect(matchTool("read_file", context({ tool: "read_XevilX" }))).toBe(false);
  });

  it("evaluates same-named regex conditions independently per policy (no cache bleed)", () => {
    const ctx = context({ args: { path: ".env" } });
    const envPolicy: Policy = {
      id: "env", pack: "test", priority: 1,
      match: { args: { path_regex: "(^|/)\\.env$" } }, action: "block", severity: "high"
    };
    const rsaPolicy: Policy = {
      id: "rsa", pack: "test", priority: 1,
      match: { args: { path_regex: "(^|/)id_rsa$" } }, action: "block", severity: "high"
    };
    expect(matchesPolicy(envPolicy, ctx)).toBe(true);
    expect(matchesPolicy(rsaPolicy, ctx)).toBe(false);
  });
});
