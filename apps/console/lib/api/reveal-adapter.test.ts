import { describe, expect, it } from "vitest";
import { toRevealContent } from "./reveal-adapter";
import type { ApiRevealResponse, Detection } from "./types";

const reveal: ApiRevealResponse = {
  eventId: "e-001",
  originalPayload: "call 010-1234-5678\nno secrets on this line",
  revealedBy: "operator@guardmcp",
  revealedAt: "2026-08-22T00:00:00Z",
  auditLogId: "audit-1"
};

describe("toRevealContent", () => {
  it("splits each line around a detection's span, masking one side and keeping the other raw", () => {
    // "call 010-1234-5678" — the phone number sits at [5, 19).
    const detections: Detection[] = [
      { type: "PII", subtype: "PHONE", confidence: 92, span: { start: 5, end: 19 }, maskedAs: "[PHONE]" }
    ];

    const content = toRevealContent(reveal, detections, "e-001  get_log", "C-20260822-001");

    expect(content.source).toBe("e-001  get_log");
    expect(content.caseId).toBe("C-20260822-001");
    expect(content.raw).toHaveLength(2);
    expect(content.raw[0]).toEqual({
      no: "01",
      parts: [{ text: "call " }, { secret: "010-1234-5678" }]
    });
    expect(content.masked[0]).toEqual({
      no: "01",
      parts: [{ text: "call " }, { mask: "PHONE" }]
    });
    // The second line has no detection on it, so both columns render it as plain text.
    expect(content.raw[1]).toEqual({ no: "02", parts: [{ text: "no secrets on this line" }] });
    expect(content.masked[1]).toEqual({ no: "02", parts: [{ text: "no secrets on this line" }] });
  });

  it("skips a detection missing span or maskedAs rather than guessing at its location", () => {
    const detections: Detection[] = [{ type: "PII", subtype: "PHONE", confidence: 92 }];

    const content = toRevealContent(reveal, detections, "e-001  get_log", "C-20260822-001");

    expect(content.raw[0]).toEqual({ no: "01", parts: [{ text: "call 010-1234-5678" }] });
    expect(content.masked[0]).toEqual({ no: "01", parts: [{ text: "call 010-1234-5678" }] });
  });
});
