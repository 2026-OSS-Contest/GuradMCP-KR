import { describe, expect, it } from "vitest";
import { evaluate, matches, type Policy } from "./index.js";

const policies: Policy[] = [
  {
    id: "warn_read", pack: "default", priority: 200, match: { tool: "read_*" },
    action: "warn", severity: "medium"
  },
  {
    id: "block_env", pack: "default", priority: 100,
    match: { direction: "request", tool: "read_file", args: { path_regex: "(^|/)\\.env$" } },
    action: "block", severity: "critical"
  }
];

it("evaluates policies by priority and adopts the strongest matching action", () => {
  const result = evaluate(policies, {
    direction: "request", tool: "read_file", serverTrust: "untrusted",
    args: { path: "/app/.env" }, detections: [], riskScore: 90
  });
  expect(result.action).toBe("block");
  expect(result.matchedPolicyIds).toEqual(["block_env", "warn_read"]);
});

describe("match axes", () => {
  it("supports trust, detection, risk, domain and enum conditions", () => {
    expect(matches({
      direction: "request",
      tool: "send_*",
      server_trust: "limited",
      args: { to_not_domain: ["company.co.kr"], channel_in: ["email", "chat"] },
      detections: { any_of: ["SECRET", "PII.RRN_LIKE"], none_of: ["SAFE"] },
      risk_score: { gte: 70, lte: 100 }
    }, {
      direction: "request", tool: "send_email", serverTrust: "limited",
      args: { to: "outside@example.com", channel: "email" },
      detections: [{ type: "SECRET", subtype: "API_KEY" }], riskScore: 75
    })).toBe(true);
  });

  it("supports the documented argument operators and label-safe domains", () => {
    expect(matches({
      tool: "fetch_?rl",
      args: {
        path_glob: "/safe/*.txt",
        mode_not_in: ["write"],
        callback_domain: ["company.co.kr"],
        optional_exists: false
      }
    }, {
      direction: "request", tool: "fetch_url", serverTrust: "trusted",
      args: { path: "/safe/readme.txt", mode: "read", callback: "https://api.company.co.kr/hook" },
      detections: [], riskScore: 0
    })).toBe(true);
    expect(matches({ args: { callback_domain: ["company.co.kr"] } }, {
      direction: "request", tool: "fetch_url", serverTrust: "trusted",
      args: { callback: "https://evilcompany.co.kr" }, detections: [], riskScore: 0
    })).toBe(false);
  });
});
