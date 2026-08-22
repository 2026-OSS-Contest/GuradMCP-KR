// Builds the reveal modal's two-column view from what the control plane actually returns
// (fix-api.md §6). `POST /events/{id}/reveal` answers `ApiRevealResponse{originalPayload, ...}`,
// not `RevealContent{raw, masked}` — the console absorbs that gap here rather than asking the
// backend to reshape its response (the doc's own call: "이건 콘솔에서 흡수하겠습니다").
//
// The span-to-parts algorithm below is a straight port of `packages/gateway/src/pipeline
// /approvalPreview.ts`'s `buildMaskPreview` (same problem — numbered lines, text/masked runs
// around detection spans — already solved and exercised there for the Approval Card's mask-diff
// preview) rather than a fresh design, adapted only for `RevealContent`'s `{secret}` part (that
// module's own `{sensitive}`) and the "raw" column also needing a value, not just a boolean.
import type { ApiRevealResponse, ContentLine, ContentPart, Detection, RevealContent } from "./types";

/** The subset of `Detection` this adapter needs — both undefined for a detection the wire
 *  contract's own optional fields never carried (see `Detection.span`'s doc comment). */
type SpannedDetection = Detection & { span: NonNullable<Detection["span"]>; maskedAs: NonNullable<Detection["maskedAs"]> };

function hasSpan(detection: Detection): detection is SpannedDetection {
  return detection.span !== undefined && detection.maskedAs !== undefined;
}

/**
 * `detections[].span` is `rawPayload`-relative (fix-api.md §6, confirmed from
 * `packages/gateway/src/pipeline/actionRouter.ts`: `rawPayload`, `mask()`, and the mask-diff
 * record all run over the same `ctx.payload` string) — the same string `reveal.originalPayload`
 * is, so no offset translation is needed between the two. A detection missing either field
 * (the VERDICT node's own detail predates this adapter, or came from a path that never set
 * them) is skipped rather than guessed at — it just renders as plain, unhighlighted text.
 */
export function toRevealContent(
  reveal: ApiRevealResponse,
  detections: Detection[],
  source: string,
  caseId: string
): RevealContent {
  const sorted = detections.filter(hasSpan).sort((a, b) => a.span.start - b.span.start);
  const lines = reveal.originalPayload.split("\n");
  const raw: ContentLine[] = [];
  const masked: ContentLine[] = [];
  let offset = 0;

  lines.forEach((lineText, index) => {
    const lineStart = offset;
    const lineEnd = offset + lineText.length;
    const onThisLine = sorted
      .filter((d) => d.span.start < lineEnd && d.span.end > lineStart)
      .map((d) => ({
        start: Math.max(0, d.span.start - lineStart),
        end: Math.min(lineText.length, d.span.end - lineStart),
        label: d.maskedAs.replace(/^\[|\]$/g, "")
      }));

    const rawParts: ContentPart[] = [];
    const maskedParts: ContentPart[] = [];
    let cursor = 0;
    for (const span of onThisLine) {
      if (span.start > cursor) {
        const text = lineText.slice(cursor, span.start);
        rawParts.push({ text });
        maskedParts.push({ text });
      }
      rawParts.push({ secret: lineText.slice(span.start, span.end) });
      maskedParts.push({ mask: span.label });
      cursor = span.end;
    }
    if (cursor < lineText.length) {
      const text = lineText.slice(cursor);
      rawParts.push({ text });
      maskedParts.push({ text });
    }
    if (rawParts.length === 0) {
      rawParts.push({ text: "" });
      maskedParts.push({ text: "" });
    }

    const no = String(index + 1).padStart(2, "0");
    raw.push({ no, parts: rawParts });
    masked.push({ no, parts: maskedParts });
    offset = lineEnd + 1;
  });

  return { source, caseId, raw, masked };
}
