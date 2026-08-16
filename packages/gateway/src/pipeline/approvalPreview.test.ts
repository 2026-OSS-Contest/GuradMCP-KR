import { describe, expect, it } from "vitest";
import type { Detection } from "../detect.js";
import { buildMaskPreview, buildRiskTags } from "./approvalPreview.js";

describe("buildRiskTags", () => {
  it("groups by top-level type, in first-seen order", () => {
    const detections: Detection[] = [
      { type: "SECRET", subtype: "LLM_API_KEY", maskedAs: "[SECRET]", start: 0, end: 5, confidence: 0.95 },
      { type: "PII", subtype: "PHONE", maskedAs: "[PHONE]", start: 10, end: 20, confidence: 0.9 },
      { type: "PII", subtype: "EMAIL", maskedAs: "[EMAIL]", start: 30, end: 40, confidence: 0.95 },
    ];
    expect(buildRiskTags(detections)).toEqual([
      { type: "SECRET", count: 1 },
      { type: "PII", count: 2 },
    ]);
  });

  it("returns an empty list for no detections", () => {
    expect(buildRiskTags([])).toEqual([]);
  });
});

describe("buildMaskPreview", () => {
  it("splits one line into text/sensitive and text/mask parts around a detection", () => {
    const text = "key sk-ant-demo0000000000000000demo";
    const start = text.indexOf("sk-ant-demo0000000000000000demo");
    const detections: Detection[] = [
      { type: "SECRET", subtype: "LLM_API_KEY", maskedAs: "[SECRET]", start, end: text.length, confidence: 0.95 },
    ];

    const preview = buildMaskPreview(text, detections);

    expect(preview.raw).toEqual([
      { no: "01", parts: [{ text: "key " }, { sensitive: "sk-ant-demo0000000000000000demo" }] },
    ]);
    expect(preview.masked).toEqual([
      { no: "01", parts: [{ text: "key " }, { mask: "SECRET" }] },
    ]);
  });

  it("numbers multiple lines and only marks the line a detection actually falls on", () => {
    const text = "line one\nphone 010-1234-5678\nline three";
    const start = text.indexOf("010-1234-5678");
    const detections: Detection[] = [
      { type: "PII", subtype: "PHONE", maskedAs: "[PHONE]", start, end: start + "010-1234-5678".length, confidence: 0.9 },
    ];

    const preview = buildMaskPreview(text, detections);

    expect(preview.raw.map((line) => line.no)).toEqual(["01", "02", "03"]);
    expect(preview.raw[0]).toEqual({ no: "01", parts: [{ text: "line one" }] });
    expect(preview.raw[1]).toEqual({ no: "02", parts: [{ text: "phone " }, { sensitive: "010-1234-5678" }] });
    expect(preview.masked[1]).toEqual({ no: "02", parts: [{ text: "phone " }, { mask: "PHONE" }] });
    expect(preview.raw[2]).toEqual({ no: "03", parts: [{ text: "line three" }] });
  });

  it("never lets the raw output contain a mask tag or the masked output contain the raw value", () => {
    const text = "token ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa end";
    const secret = "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const start = text.indexOf(secret);
    const detections: Detection[] = [
      { type: "SECRET", subtype: "GITHUB_TOKEN", maskedAs: "[GITHUB_TOKEN]", start, end: start + secret.length, confidence: 0.95 },
    ];

    const preview = buildMaskPreview(text, detections);
    const rawText = JSON.stringify(preview.raw);
    const maskedText = JSON.stringify(preview.masked);
    expect(rawText).toContain(secret);
    expect(maskedText).not.toContain(secret);
    expect(maskedText).toContain("GITHUB_TOKEN");
  });
});
