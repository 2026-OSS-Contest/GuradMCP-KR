// The reveal modal is the one screen in the console that shows an unmasked value, so the test
// that matters is not "does it render" but "does the masked column beside it say the truth".
//
// The first case is a contract test in the strict sense: it feeds the adapter what the control
// plane would answer for the demo ticket, and asserts the result is *the hand-written fixture*
// the design was drawn from — same lines, same numbering, same parts. Two independent
// descriptions of the same body agreeing is what makes the derived one trustworthy.

import { describe, expect, it } from "vitest";
import { toRevealContent } from "./reveal-adapter";
import type { ApiRevealResponse, Detection } from "./types";
// Relative, not `@/`: vitest runs from the repository root and resolves no console path alias.
import { TICKET_DETECTIONS, TICKET_MASKED, TICKET_RAW, TICKET_RAW_PAYLOAD } from "../../mocks/demo-story";

/** As `toEventDetail` hands them over: wire confidence scaled, span and maskedAs passed through. */
const asDetections = (wire: typeof TICKET_DETECTIONS): Detection[] =>
  wire.map((d) => ({
    type: d.type,
    subtype: d.subtype,
    confidence: Math.round(d.confidence * 100),
    span: d.span,
    maskedAs: d.maskedAs
  }));

const response = (rawPayload: string, eventId = "e10"): ApiRevealResponse => ({
  eventId,
  rawPayload,
  revealedBy: "operator",
  revealedAt: "2026-08-26T10:00:00Z"
});

const detection = (start: number, end: number, maskedAs = "PHONE"): Detection => ({
  type: "PII",
  subtype: maskedAs,
  confidence: 98,
  span: { start, end },
  maskedAs
});

describe("toRevealContent", () => {
  it("rebuilds the demo ticket's two columns exactly as the design's own fixture writes them", () => {
    const content = toRevealContent(response(TICKET_RAW_PAYLOAD), asDetections(TICKET_DETECTIONS), "search_tickets");

    expect(content).not.toBeNull();
    expect(content!.raw).toEqual(TICKET_RAW);
    expect(content!.masked).toEqual(TICKET_MASKED);
  });

  it("titles the pane with a short event id and the tool that was judged", () => {
    const content = toRevealContent(
      response(TICKET_RAW_PAYLOAD, "7c9e0a11-4d2b-4f3a-9e51-0b1c2d3e4f50"),
      asDetections(TICKET_DETECTIONS),
      "search_tickets"
    );

    expect(content!.source).toBe("7c9e0a11  search_tickets");
    // No API reports a case number, so the caption carries none rather than a placeholder.
    expect(content!.caseId).toBeUndefined();
  });

  it("numbers both columns from one, so a line can be read across", () => {
    const content = toRevealContent(response("a\nb\nc"), [], "get_log");

    expect(content!.raw.map((line) => line.no)).toEqual(["01", "02", "03"]);
    expect(content!.masked.map((line) => line.no)).toEqual(["01", "02", "03"]);
  });

  it("keeps an empty line as a line, or the columns stop lining up", () => {
    const content = toRevealContent(response("first\n\nthird"), [], "get_log");

    expect(content!.raw).toHaveLength(3);
    expect(content!.raw[1]).toEqual({ no: "02", parts: [{ text: "" }] });
  });

  it("shows a payload with no findings identically on both sides", () => {
    const content = toRevealContent(response("nothing sensitive here"), [], "get_log");

    expect(content!.raw).toEqual([{ no: "01", parts: [{ text: "nothing sensitive here" }] }]);
    expect(content!.masked).toEqual(content!.raw);
  });

  it("masks a finding that straddles a newline on every line it covers", () => {
    // Leaving the continuation line as plain text is the leak this guards; repeating the token
    // is the price of keeping the columns line-for-line.
    const content = toRevealContent(response("call 010-\n3456-7890 now"), [detection(5, 19)], "get_log");

    expect(content!.raw[0].parts).toEqual([{ text: "call " }, { secret: "010-" }]);
    expect(content!.raw[1].parts).toEqual([{ secret: "3456-7890" }, { text: " now" }]);
    expect(content!.masked[0].parts).toEqual([{ text: "call " }, { mask: "PHONE" }]);
    expect(content!.masked[1].parts).toEqual([{ mask: "PHONE" }, { text: " now" }]);
  });

  it("places findings in document order however they arrive", () => {
    const content = toRevealContent(
      response("b@x.kr and 010-3456-7890"),
      [detection(11, 24, "PHONE"), detection(0, 6, "EMAIL")],
      "get_log"
    );

    expect(content!.masked[0].parts).toEqual([
      { mask: "EMAIL" },
      { text: " and " },
      { mask: "PHONE" }
    ]);
  });

  // Everything below declines. A detection that cannot be placed is not simply absent from the
  // masked column — the text it covered falls through as ordinary content, so the pane meant to
  // show what the agent saw would print the secret instead.
  it.each([
    ["a span past the end of the payload", detection(0, 999)],
    ["a span that ends before it starts", detection(9, 4)],
    ["an empty span", detection(4, 4)],
    ["a negative offset", detection(-1, 4)],
    ["a fractional offset", detection(0.5, 4)]
  ])("declines on %s", (_case, bad) => {
    expect(toRevealContent(response("010-3456-7890 is the number"), [bad], "get_log")).toBeNull();
  });

  it("declines when a control plane reports a finding without saying where it fell", () => {
    const spanless: Detection = { type: "PII", subtype: "PHONE", confidence: 98, maskedAs: "PHONE" };
    expect(toRevealContent(response("010-3456-7890"), [spanless], "get_log")).toBeNull();

    const tokenless: Detection = { type: "PII", subtype: "PHONE", confidence: 98, span: { start: 0, end: 13 } };
    expect(toRevealContent(response("010-3456-7890"), [tokenless], "get_log")).toBeNull();
  });

  it("declines when two findings claim the same characters", () => {
    // Whichever token won would be a choice this module invented.
    const overlapping = [detection(0, 8, "PHONE"), detection(4, 13, "RRN_LIKE")];
    expect(toRevealContent(response("010-3456-7890"), overlapping, "get_log")).toBeNull();
  });

  it("allows two findings that merely touch", () => {
    const adjacent = [detection(0, 4, "PHONE"), detection(4, 13, "RRN_LIKE")];
    const content = toRevealContent(response("010-3456-7890"), adjacent, "get_log");

    expect(content!.masked[0].parts).toEqual([{ mask: "PHONE" }, { mask: "RRN_LIKE" }]);
  });

  it("drops a CRLF payload's carriage returns without shifting the spans that follow", () => {
    const content = toRevealContent(response("call\r\n010-3456-7890"), [detection(6, 19)], "get_log");

    expect(content!.raw[0].parts).toEqual([{ text: "call" }]);
    expect(content!.raw[1].parts).toEqual([{ secret: "010-3456-7890" }]);
  });
});
