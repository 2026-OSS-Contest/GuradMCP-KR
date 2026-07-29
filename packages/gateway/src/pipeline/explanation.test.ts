import { describe, expect, it } from "vitest";
import { explainDecision } from "./explanation.js";
import type { PolicyDecision } from "./types.js";

function decision(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    verdict: "block",
    matchedPolicyIds: ["block_env_file_read"],
    riskScore: 96,
    severity: "critical",
    reasonCode: "BLOCK_ENV_FILE_READ",
    message: "Credential-file access was blocked by policy.",
    detections: [],
    ...overrides
  };
}

const detection = (type: "PII" | "SECRET" | "INJECTION", subtype: string) => ({
  type, subtype, maskedAs: `[${subtype}]`, start: 0, end: 1, confidence: 0.9
});

describe("explanation generator (GMCP-53)", () => {
  it("states the verdict, deciding policy, and severity as fact", () => {
    const { ko, en } = explainDecision(decision());
    expect(ko).toBe("차단했습니다 — 정책 block_env_file_read (심각도 critical). 위험 점수 96.");
    expect(en).toBe("Blocked — policy block_env_file_read (severity critical). Risk score 96.");
  });

  it("carries the reason code unchanged across locales", () => {
    expect(explainDecision(decision()).reasonCode).toBe("BLOCK_ENV_FILE_READ");
  });

  it("summarizes detections by type and count", () => {
    const { ko, en } = explainDecision(decision({
      detections: [detection("PII", "PHONE"), detection("PII", "RRN_LIKE"), detection("SECRET", "JWT")]
    }));
    expect(ko).toContain("탐지 PII 2건, SECRET 1건");
    expect(en).toContain("Detected PII ×2, SECRET ×1");
  });

  it("never repeats the matched text, only tags and counts (NFR-04)", () => {
    const leaky = { ...detection("PII", "PHONE"), maskedAs: "[PHONE]" };
    const explanation = explainDecision(decision({ detections: [leaky] }));
    expect(JSON.stringify(explanation)).not.toContain("010-");
    expect(explanation.ko).toContain("PII 1건");
  });

  it("says so plainly when no policy matched", () => {
    const { ko, en } = explainDecision(decision({ matchedPolicyIds: [], reasonCode: "NO_POLICY_MATCH" }));
    expect(ko).toContain("매칭된 정책 없음, 정책팩 기본 동작");
    expect(en).toContain("no policy matched, pack default action");
  });

  it("describes the verdict the router actually reached, not the one proposed", () => {
    // An approval that times out is recorded as the block it became.
    const { ko } = explainDecision(decision({ verdict: "require_approval" }), "block");
    expect(ko.startsWith("차단했습니다")).toBe(true);
  });

  it("produces a sentence for every verdict", () => {
    for (const verdict of ["allow", "warn", "mask_then_allow", "require_approval", "block"] as const) {
      const { ko, en } = explainDecision(decision(), verdict);
      expect(ko.length).toBeGreaterThan(0);
      expect(en.length).toBeGreaterThan(0);
    }
  });

  it("keeps the tone factual: no exclamation marks or inflated wording (§10.6)", () => {
    for (const verdict of ["allow", "warn", "mask_then_allow", "require_approval", "block"] as const) {
      const { ko, en } = explainDecision(decision({ detections: [detection("SECRET", "AWS_ACCESS_KEY")] }), verdict);
      for (const sentence of [ko, en]) {
        expect(sentence).not.toContain("!");
        expect(sentence.toLowerCase()).not.toMatch(/위험합니다|긴급|dangerous|critical risk|urgent/);
      }
    }
  });
});
