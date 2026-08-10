import { describe, expect, it } from "vitest";
import type { Detection, DetectionKind } from "./detect.js";
import { classifyTool, riskThresholds, scoreRisk } from "./risk.js";

function detection(type: DetectionKind, subtype: string, confidence = 0.9): Detection {
  return { type, subtype, maskedAs: `[${subtype}]`, start: 0, end: 1, confidence };
}

describe("risk scoring", () => {
  it("scores a payload with no detections as zero risk regardless of trust or tool", () => {
    const assessment = scoreRisk([], "send_email", "untrusted");
    expect(assessment.score).toBe(0);
    expect(assessment.baseScore).toBe(0);
  });

  it("puts a confident injection from an untrusted server in the block band", () => {
    const { score } = scoreRisk([detection("INJECTION", "IGNORE_INSTRUCTIONS")], "tools/list", "untrusted");
    expect(score).toBeGreaterThanOrEqual(riskThresholds.block);
  });

  it("puts personal data leaving through email from a limited server in the approval band", () => {
    const { score } = scoreRisk([detection("PII", "PHONE")], "send_email", "limited");
    expect(score).toBeGreaterThanOrEqual(riskThresholds.approval);
    expect(score).toBeLessThan(riskThresholds.block);
  });

  // FR-GW-02 §4.3: the same finding from an untrusted server is scaled harder
  // (×1.6 vs ×1.3) and, since send_email is a high-risk tool, floored — so the
  // identical detection that only reaches "approval" on a limited server lands
  // in "block" once the source server is untrusted.
  it("pushes the same email exfiltration into the block band when the server is untrusted", () => {
    const { score } = scoreRisk([detection("PII", "PHONE")], "send_email", "untrusted");
    expect(score).toBeGreaterThanOrEqual(riskThresholds.block);
  });

  it("scores an external secret transfer into the approval band (Appendix A.2)", () => {
    const { score } = scoreRisk([detection("SECRET", "LLM_API_KEY", 0.95)], "send_email", "untrusted");
    expect(score).toBeGreaterThanOrEqual(riskThresholds.approval);
  });

  it("ranks server trust so the same finding is safer on a trusted server", () => {
    const untrusted = scoreRisk([detection("SECRET", "GITHUB_TOKEN", 0.95)], "read_file", "untrusted").score;
    const limited = scoreRisk([detection("SECRET", "GITHUB_TOKEN", 0.95)], "read_file", "limited").score;
    const trusted = scoreRisk([detection("SECRET", "GITHUB_TOKEN", 0.95)], "read_file", "trusted").score;
    expect(untrusted).toBeGreaterThan(limited);
    expect(limited).toBeGreaterThan(trusted);
  });

  it("ranks tool capability so an outbound tool outweighs a passive one", () => {
    const findings = [detection("PII", "EMAIL", 0.95)];
    expect(scoreRisk(findings, "send_email", "limited").score)
      .toBeGreaterThan(scoreRisk(findings, "customer_lookup", "limited").score);
  });

  it("raises the score for bulk personal-data disclosure", () => {
    const one = scoreRisk([detection("PII", "PHONE")], "customer_lookup", "untrusted");
    const many = scoreRisk(Array.from({ length: 10 }, () => detection("PII", "PHONE")), "customer_lookup", "untrusted");
    expect(many.factors.volume).toBeGreaterThan(one.factors.volume);
    expect(many.score).toBeGreaterThan(one.score);
  });

  it("keeps the score inside the gauge range", () => {
    const findings = [
      detection("INJECTION", "IGNORE_INSTRUCTIONS", 1),
      detection("INJECTION", "EXFILTRATION", 1),
      detection("SECRET", "PRIVATE_KEY", 0.99),
      ...Array.from({ length: 12 }, () => detection("PII", "PHONE"))
    ];
    expect(scoreRisk(findings, "send_email", "untrusted").score).toBe(100);
  });

  it("classifies tools from the shipped catalog and defaults unknown tools to low", () => {
    expect(classifyTool("send_email")).toBe("high");
    expect(classifyTool("write_file")).toBe("high");
    expect(classifyTool("read_file")).toBe("medium");
    expect(classifyTool("customer_lookup")).toBe("medium");
    expect(classifyTool("tools/list")).toBe("low");
  });
});
