// Builds the pre-decision evidence an Approval Card needs (§5.1 SCR-402): risk tags
// (grouped detection counts) and the raw/masked mask-diff preview. Both are computed
// from the *pending* request — the raw text is legitimately in flight here (nothing has
// been sent anywhere yet) — unlike a resolved GuardEvent, which only ever keeps a
// `maskDiffRef` digest (NFR-04). Nothing here is persisted past the approval's own
// pending window; the caller (Control Plane) is expected to drop the raw side once the
// approval resolves.
import type { Detection } from "../detect.js";

export interface RiskTag {
  type: string;
  count: number;
}

export type RawPart = { text: string } | { sensitive: string };
export interface RawLine {
  no: string;
  parts: RawPart[];
}

export type ContentPart = { text: string } | { mask: string };
export interface ContentLine {
  no: string;
  parts: ContentPart[];
}

export interface MaskPreview {
  raw: RawLine[];
  masked: ContentLine[];
}

/** `{SECRET: 1, PII: 2}` shaped counts, in first-seen order — matches the card's evidence chips. */
export function buildRiskTags(detections: Detection[]): RiskTag[] {
  const counts = new Map<string, number>();
  for (const { type } of detections) counts.set(type, (counts.get(type) ?? 0) + 1);
  return [...counts.entries()].map(([type, count]) => ({ type, count }));
}

/** Splits `text` into numbered lines, each line into text/sensitive (raw) and text/mask
 *  (masked) parts around every detection span that falls on it. */
export function buildMaskPreview(text: string, detections: Detection[]): MaskPreview {
  const sorted = [...detections].sort((a, b) => a.start - b.start);
  const lines = text.split("\n");
  const raw: RawLine[] = [];
  const masked: ContentLine[] = [];
  let offset = 0;
  lines.forEach((lineText, index) => {
    const lineStart = offset;
    const lineEnd = offset + lineText.length;
    const onThisLine = sorted
      .filter((d) => d.start < lineEnd && d.end > lineStart)
      .map((d) => ({
        start: Math.max(0, d.start - lineStart),
        end: Math.min(lineText.length, d.end - lineStart),
        label: d.maskedAs.replace(/^\[|\]$/g, ""),
      }));

    const rawParts: RawPart[] = [];
    const maskedParts: ContentPart[] = [];
    let cursor = 0;
    for (const span of onThisLine) {
      if (span.start > cursor) {
        const text = lineText.slice(cursor, span.start);
        rawParts.push({ text });
        maskedParts.push({ text });
      }
      rawParts.push({ sensitive: lineText.slice(span.start, span.end) });
      maskedParts.push({ mask: span.label });
      cursor = span.end;
    }
    if (cursor < lineText.length) {
      const text = lineText.slice(cursor);
      rawParts.push({ text });
      maskedParts.push({ text });
    }

    const no = String(index + 1).padStart(2, "0");
    raw.push({ no, parts: rawParts });
    masked.push({ no, parts: maskedParts });
    offset = lineEnd + 1;
  });
  return { raw, masked };
}
