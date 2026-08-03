import { describe, expect, it } from "vitest";
import { explainDecision } from "./explanation.js";
import type { PolicyDecision } from "./types.js";

function decision(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    verdict: "block",
    matchedPolicyIds: ["block_env_file_read"],
    decidingPolicyId: "block_env_file_read",
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

  describe("with more than one policy matched", () => {
    // Reproduces the shipped korean-pii pack: an external email carrying both an
    // injection string and a secret matches warn_injection_request (priority 130) and
    // approve_external_email_with_secret (priority 200). severity-max adopts the second,
    // so matchedPolicyIds[0] is the policy that did *not* decide.
    const multi = decision({
      verdict: "require_approval",
      matchedPolicyIds: ["warn_injection_request", "approve_external_email_with_secret"],
      decidingPolicyId: "approve_external_email_with_secret",
      severity: "high",
      reasonCode: "APPROVE_EXTERNAL_EMAIL_WITH_SECRET"
    });

    it("names the policy that decided, not the first one that matched", () => {
      const { ko, en } = explainDecision(multi);
      expect(ko).toContain("정책 approve_external_email_with_secret");
      expect(en).toContain("policy approve_external_email_with_secret");
      expect(ko).not.toContain("정책 warn_injection_request");
      expect(en).not.toContain("policy warn_injection_request");
    });

    it("keeps the named policy consistent with the reason code on the same decision", () => {
      const { ko, reasonCode } = explainDecision(multi);
      // severity, reasonCode, and message all come from the deciding policy, so the
      // sentence must name that same policy or it contradicts its own event.
      expect(ko).toContain(reasonCode.toLowerCase());
      expect(ko).toContain("심각도 high");
    });

    it("accounts for the other matches without listing them", () => {
      expect(explainDecision(multi).ko).toContain("외 1건 매칭");
      expect(explainDecision(multi).en).toContain("1 other matched");
      const three = explainDecision(decision({
        matchedPolicyIds: ["a", "b", "c"],
        decidingPolicyId: "b"
      }));
      expect(three.ko).toContain("외 2건 매칭");
      expect(three.en).toContain("2 others matched");
    });
  });

  it("summarizes detections by full tag so subtypes survive", () => {
    const { ko, en } = explainDecision(decision({
      detections: [detection("PII", "PHONE"), detection("PII", "RRN_LIKE"), detection("PII", "PHONE")]
    }));
    // PII.RRN_LIKE and PII.PHONE call for different responses; collapsing both to "PII"
    // would drop the part a reader acts on.
    expect(ko).toContain("탐지 PII.PHONE 2건, PII.RRN_LIKE 1건");
    expect(en).toContain("Detected PII.PHONE ×2, PII.RRN_LIKE ×1");
  });

  it("repeats no free-text field from the decision or its detections (NFR-04)", () => {
    // Poison every string the generator can reach; none may surface in either locale.
    const explanation = explainDecision(decision({
      message: "CANARY-MESSAGE the raw payload said 010-1234-5678",
      detections: [{ ...detection("PII", "PHONE"), subtype: "CANARY-SUBTYPE", maskedAs: "CANARY-MASK" }]
    }));
    const serialized = JSON.stringify(explanation);
    expect(serialized).not.toContain("CANARY-MESSAGE");
    expect(serialized).not.toContain("CANARY-MASK");
    expect(serialized).not.toContain("010-1234-5678");
    // The subtype is a detector tag, so it is named — that is the evidence, not the text.
    expect(explanation.ko).toContain("PII.CANARY-SUBTYPE 1건");
  });

  it("says so plainly when no policy matched", () => {
    const { ko, en } = explainDecision(decision({ matchedPolicyIds: [], decidingPolicyId: null, reasonCode: "NO_POLICY_MATCH" }));
    expect(ko).toContain("매칭된 정책 없음, 정책팩 기본 동작");
    expect(en).toContain("no policy matched, pack default action");
  });

  it("describes the verdict the router actually reached, not the one proposed", () => {
    const { ko } = explainDecision(decision({ verdict: "require_approval" }), "block");
    expect(ko.startsWith("차단했습니다")).toBe(true);
  });

  it("distinguishes a timed-out approval from a policy block", () => {
    const proposed = decision({ verdict: "require_approval", severity: "high" });
    const expired = explainDecision(proposed, "block", "expired");
    const denied = explainDecision(proposed, "block", "denied");
    const straight = explainDecision(decision(), "block");
    expect(expired.ko).toContain("승인 시간이 초과되어");
    expect(expired.en).toContain("the approval timed out");
    expect(denied.ko).toContain("승인이 거부되어");
    // All three are blocks, but a reader can tell which is which.
    expect(new Set([expired.ko, denied.ko, straight.ko]).size).toBe(3);
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
