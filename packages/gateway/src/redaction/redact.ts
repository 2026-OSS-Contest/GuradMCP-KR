// GMCP-37 Redaction Engine (spec §3, §4). Pure function: no I/O, no network,
// so the mask_then_allow and approve_masked call sites are guaranteed to
// produce byte-identical output for the same (text, detections) input (§6).
import type { AppliedSpan, Detection, DiffSegment, MaskDiff, RedactionInput, RedactionResult } from "./types.js";

/** §3.2: gap under which two spans are treated as adjacent and merged. */
const ADJACENT_GAP_THRESHOLD = 1;

/**
 * §3.4 tag priority, most sensitive first. SECRET and INJECTION are
 * unqualified (any subtype of that type wins at that rank); PII entries are
 * qualified by subtype. PASSPORT and DL_NO share one rank.
 */
const PRIORITY_GROUPS: readonly (readonly string[])[] = [
  ["SECRET"],
  ["PII.RRN_LIKE"],
  ["PII.CARD"],
  ["PII.BANK_ACCOUNT"],
  ["PII.BIZ_NO"],
  ["PII.PASSPORT", "PII.DL_NO"],
  ["PII.PHONE"],
  ["PII.ADDRESS"],
  ["PII.EMAIL"],
  ["INJECTION"]
];

const PRIORITY_RANK = new Map<string, number>();
PRIORITY_GROUPS.forEach((keys, rank) => {
  for (const key of keys) PRIORITY_RANK.set(key, rank);
});

/** A PII subtype absent from the table ranks after EMAIL but ahead of INJECTION. */
const UNKNOWN_PII_RANK = PRIORITY_GROUPS.length - 1.5;

export function redact(input: RedactionInput): RedactionResult {
  const { text, detections, options = {} } = input;
  const minConfidence = options.minConfidence ?? 0;
  const annotateMergedTags = options.annotateMergedTags ?? false;
  const includeOriginalInDiff = options.includeOriginalInDiff ?? false;

  const eligible = detections.filter((detection) => detection.confidence >= minConfidence);
  const sorted = sortDetections(eligible);
  const groups = mergeGroups(sorted);
  const appliedSpans = groups.map((group) => toAppliedSpan(text, group, annotateMergedTags));

  const { maskedText, segments } = buildOutput(text, appliedSpans);
  const diff: MaskDiff = {
    masked: maskedText,
    segments,
    summary: buildSummary(appliedSpans)
  };
  if (includeOriginalInDiff) diff.original = text;

  return { maskedText, diff, appliedSpans };
}

/** §3.1: start ascending, tie-break end descending (wider span first). */
function sortDetections(detections: Detection[]): Detection[] {
  return [...detections].sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end);
}

/**
 * §3.2: single sorted-order scan, chaining merges against the running
 * merged end (not each detection's own end) so a wide span followed by a
 * nested narrower one never reopens a gap.
 */
function mergeGroups(sorted: Detection[]): Detection[][] {
  const groups: Detection[][] = [];
  let current: Detection[] = [];
  let currentEnd = -Infinity;
  for (const detection of sorted) {
    if (current.length > 0 && detection.span.start - currentEnd <= ADJACENT_GAP_THRESHOLD) {
      current.push(detection);
      currentEnd = Math.max(currentEnd, detection.span.end);
      continue;
    }
    if (current.length > 0) groups.push(current);
    current = [detection];
    currentEnd = detection.span.end;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function toAppliedSpan(text: string, group: Detection[], annotateMergedTags: boolean): AppliedSpan {
  const span = groupSpan(group);
  warnIfSurrogateBoundary(text, span);
  return {
    span,
    sourceDetections: group,
    maskedAs: resolveMaskedAs(group, annotateMergedTags)
  };
}

function groupSpan(group: Detection[]): { start: number; end: number } {
  return group.reduce(
    (acc, detection) => ({
      start: Math.min(acc.start, detection.span.start),
      end: Math.max(acc.end, detection.span.end)
    }),
    { start: Infinity, end: -Infinity }
  );
}

/** §3.3: same subtype throughout, or annotateMergedTags is off, both resolve to the dominant tag. */
function resolveMaskedAs(group: Detection[], annotateMergedTags: boolean): string {
  const uniqueKeys = new Set(group.map((detection) => `${detection.type}:${detection.subtype}`));
  if (uniqueKeys.size === 1 || !annotateMergedTags) return dominant(group).maskedAs;
  return `[${sourceTypeLabels(group).join("+")}]`;
}

function dominant(group: Detection[]): Detection {
  return group.reduce((best, detection) => (priorityRank(detection) < priorityRank(best) ? detection : best));
}

/** §3.4 label as used in the priority table itself: bare type name for SECRET/INJECTION, subtype for PII. */
function tagLabel(detection: Detection): string {
  return detection.type === "PII" ? detection.subtype : detection.type;
}

function priorityRank(detection: Detection): number {
  const key = detection.type === "PII" ? `PII.${detection.subtype}` : detection.type;
  const rank = PRIORITY_RANK.get(key);
  if (rank !== undefined) return rank;
  return detection.type === "PII" ? UNKNOWN_PII_RANK : PRIORITY_RANK.get("INJECTION") ?? PRIORITY_GROUPS.length - 1;
}

/** Distinct labels involved in a merge, most sensitive first. Backs both the annotated tag and DiffSegment.sourceTypes. */
function sourceTypeLabels(group: Detection[]): string[] {
  const ranked = new Map<string, number>();
  for (const detection of group) {
    const label = tagLabel(detection);
    if (!ranked.has(label)) ranked.set(label, priorityRank(detection));
  }
  return [...ranked.entries()].sort((a, b) => a[1] - b[1]).map(([label]) => label);
}

/**
 * §4: walks appliedSpans in original-text order, copying untouched
 * stretches and substituting `maskedAs` for each span. All indices stay in
 * original coordinates; the masked string is assembled once at the end.
 */
function buildOutput(text: string, appliedSpans: AppliedSpan[]): { maskedText: string; segments: DiffSegment[] } {
  const parts: string[] = [];
  const segments: DiffSegment[] = [];
  let cursor = 0;

  for (const applied of appliedSpans) {
    if (applied.span.start > cursor) {
      const plain = text.slice(cursor, applied.span.start);
      parts.push(plain);
      segments.push({ kind: "plain", text: plain });
    }
    parts.push(applied.maskedAs);
    segments.push({
      kind: "masked",
      tag: applied.maskedAs,
      originalSpan: { start: applied.span.start, end: applied.span.end },
      sourceTypes: sourceTypeLabels(applied.sourceDetections)
    });
    cursor = applied.span.end;
  }

  if (cursor < text.length || appliedSpans.length === 0) {
    const plain = text.slice(cursor);
    parts.push(plain);
    segments.push({ kind: "plain", text: plain });
  }

  return { maskedText: parts.join(""), segments };
}

function buildSummary(appliedSpans: AppliedSpan[]): MaskDiff["summary"] {
  const byType: Record<string, number> = {};
  for (const applied of appliedSpans) {
    for (const detection of applied.sourceDetections) {
      byType[detection.subtype] = (byType[detection.subtype] ?? 0) + 1;
    }
  }
  return { totalSpans: appliedSpans.length, byType };
}

/** §9: detector spans are contracted to land on code-point boundaries; this only guards and warns, it never rewrites a span. */
function warnIfSurrogateBoundary(text: string, span: { start: number; end: number }): void {
  if (isLowSurrogate(text.charCodeAt(span.start)) || isLowSurrogate(text.charCodeAt(span.end))) {
    console.warn(`[redaction] span [${span.start}, ${span.end}) cuts through a UTF-16 surrogate pair`);
  }
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}
