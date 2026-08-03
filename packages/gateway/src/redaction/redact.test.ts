import { describe, expect, it } from "vitest";
import { redact } from "./index.js";
import type { Detection } from "./types.js";

function detection(overrides: Partial<Detection> & Pick<Detection, "subtype" | "span" | "maskedAs">): Detection {
  return { type: "PII", confidence: 0.9, ...overrides };
}

describe("redact", () => {
  it("replaces a single span with its mask tag (§8.1)", () => {
    const text = "010-1234-5678";
    const result = redact({
      text,
      detections: [detection({ subtype: "PHONE", span: { start: 0, end: 13 }, maskedAs: "[PHONE]" })]
    });
    expect(result.maskedText).toBe("[PHONE]");
    expect(result.appliedSpans).toHaveLength(1);
  });

  it("merges overlapping spans into one applied span (§8.2)", () => {
    const text = "0123456789012345678901234567";
    const result = redact({
      text,
      detections: [
        detection({ subtype: "PHONE", span: { start: 10, end: 24 }, maskedAs: "[PHONE]" }),
        detection({ subtype: "PHONE", span: { start: 8, end: 26 }, maskedAs: "[PHONE]" })
      ]
    });
    expect(result.appliedSpans).toHaveLength(1);
    expect(result.appliedSpans[0]?.span).toEqual({ start: 8, end: 26 });
  });

  it("merges spans exactly at the adjacency threshold, keeps wider gaps split (§8.3)", () => {
    const text = "AAAAA BBBBB";
    const touching = redact({
      text,
      detections: [
        detection({ subtype: "PHONE", span: { start: 0, end: 5 }, maskedAs: "[PHONE]" }),
        detection({ subtype: "PHONE", span: { start: 6, end: 11 }, maskedAs: "[PHONE]" })
      ]
    });
    expect(touching.appliedSpans).toHaveLength(1);

    const text2 = "AAAAA  BBBBB";
    const apart = redact({
      text: text2,
      detections: [
        detection({ subtype: "PHONE", span: { start: 0, end: 5 }, maskedAs: "[PHONE]" }),
        detection({ subtype: "PHONE", span: { start: 7, end: 12 }, maskedAs: "[PHONE]" })
      ]
    });
    expect(apart.appliedSpans).toHaveLength(2);
  });

  it("resolves subtype conflicts by priority, or annotates all involved tags (§8.4)", () => {
    // EMAIL sorts first (lower start) but SECRET outranks it — dominant() must
    // not just pick the first element of the merged group.
    const text = "a@b.com AKIAABCDEFGH";
    const detections: Detection[] = [
      detection({ type: "PII", subtype: "EMAIL", span: { start: 0, end: 7 }, maskedAs: "[EMAIL]" }),
      detection({ type: "SECRET", subtype: "AWS_KEY", span: { start: 8, end: 20 }, maskedAs: "[AWS_KEY]" })
    ];

    const prioritized = redact({ text, detections });
    expect(prioritized.appliedSpans).toHaveLength(1);
    expect(prioritized.appliedSpans[0]?.maskedAs).toBe("[AWS_KEY]");

    const annotated = redact({ text, detections, options: { annotateMergedTags: true } });
    expect(annotated.appliedSpans[0]?.maskedAs).toBe("[SECRET+EMAIL]");
  });

  it("excludes detections below minConfidence and leaves them as plain text (§8.5)", () => {
    const text = "maybe 010-1234-5678 here";
    const result = redact({
      text,
      detections: [detection({ subtype: "PHONE", span: { start: 6, end: 19 }, maskedAs: "[PHONE]", confidence: 0.3 })],
      options: { minConfidence: 0.5 }
    });
    expect(result.maskedText).toBe(text);
    expect(result.appliedSpans).toHaveLength(0);
  });

  it("keeps later span coordinates fixed to original text regardless of earlier replacements (§8.6)", () => {
    const text = "phone 010-1234-5678 email a@b.com end";
    const result = redact({
      text,
      detections: [
        detection({ subtype: "PHONE", span: { start: 6, end: 19 }, maskedAs: "[PHONE]" }),
        detection({ subtype: "EMAIL", span: { start: 26, end: 33 }, maskedAs: "[EMAIL]" })
      ]
    });
    const maskedSegments = result.diff.segments.filter((segment) => segment.kind === "masked");
    expect(maskedSegments[0]?.originalSpan).toEqual({ start: 6, end: 19 });
    expect(maskedSegments[1]?.originalSpan).toEqual({ start: 26, end: 33 });
    expect(result.maskedText).toBe("phone [PHONE] email [EMAIL] end");
  });

  it("produces segments whose boundaries exactly reconstruct the original span coverage (§8.7)", () => {
    const text = "start 010-1234-5678 middle a@b.com end";
    const result = redact({
      text,
      detections: [
        detection({ subtype: "PHONE", span: { start: 6, end: 19 }, maskedAs: "[PHONE]" }),
        detection({ subtype: "EMAIL", span: { start: 27, end: 34 }, maskedAs: "[EMAIL]" })
      ]
    });
    let covered = 0;
    for (const segment of result.diff.segments) {
      covered += segment.kind === "plain" ? (segment.text?.length ?? 0) : (segment.originalSpan ? segment.originalSpan.end - segment.originalSpan.start : 0);
    }
    expect(covered).toBe(text.length);
    expect(result.diff.segments[1]?.originalSpan).toEqual({ start: 6, end: 19 });
    expect(result.maskedText).toBe("start [PHONE] middle [EMAIL] end");
  });

  it("defaults to omitting original text and masked-segment text (NFR-04, §8.8)", () => {
    const text = "010-1234-5678";
    const result = redact({
      text,
      detections: [detection({ subtype: "PHONE", span: { start: 0, end: 13 }, maskedAs: "[PHONE]" })]
    });
    expect(result.diff.original).toBeUndefined();
    for (const segment of result.diff.segments) {
      if (segment.kind === "masked") expect(segment.text).toBeUndefined();
    }
  });

  it("produces byte-identical output across repeated calls with the same input (§8.9)", () => {
    const text = "고객 연락처는 010-1234-5678이고 계좌는 110-123-456789입니다.";
    const detections: Detection[] = [
      detection({ subtype: "PHONE", span: { start: 8, end: 21 }, maskedAs: "[PHONE]" }),
      detection({ subtype: "BANK_ACCOUNT", span: { start: 25, end: 39 }, maskedAs: "[BANK_ACCOUNT]" })
    ];
    const first = redact({ text, detections });
    const second = redact({ text, detections });
    expect(second.maskedText).toBe(first.maskedText);
  });

  it("returns the text unchanged with a single plain segment when there are no detections (§8.10)", () => {
    const text = "nothing sensitive here";
    const result = redact({ text, detections: [] });
    expect(result.maskedText).toBe(text);
    expect(result.diff.segments).toHaveLength(1);
    expect(result.diff.segments[0]?.kind).toBe("plain");
  });

  it("masks a span covering the entire text (§8.11)", () => {
    const text = "-----BEGIN PRIVATE KEY-----\nMIIB...\n-----END PRIVATE KEY-----";
    const result = redact({
      text,
      detections: [detection({ type: "SECRET", subtype: "PRIVATE_KEY", span: { start: 0, end: text.length }, maskedAs: "[PRIVATE_KEY]" })]
    });
    expect(result.maskedText).toBe("[PRIVATE_KEY]");
    expect(result.diff.segments).toHaveLength(1);
    expect(result.diff.segments[0]?.kind).toBe("masked");
  });
});
