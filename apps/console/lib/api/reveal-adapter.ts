// `POST /events/{id}/reveal` answers a flat string; the reveal modal draws two numbered columns
// of typed runs. This is the join between them.
//
// Why it exists at all: `AuditEventController.RevealResponse` is
// `{eventId, rawPayload, revealedBy, revealedAt}` and `RevealContent` is
// `{source, caseId, raw[], masked[]}` — not one field in common. Until now `revealEvent` was
// typed `post<RevealContent>` and the mock obligingly served that shape, so the flow worked in
// dev and would have handed the modal `content.raw === undefined` against a real control plane.
// That is the GMCP-117 failure again: a mock emitting a shape the system never produces.
//
// The masked column is the load-bearing one. It is what the agent was allowed to see, and the
// operator reads it *against* the raw column to check that the masking actually covered what it
// claims to have covered. So it is reconstructed from the event's own detections rather than
// re-derived here: the console has no detector, and a masked pane the console guessed at proves
// nothing about what the gateway did.

import type { ApiRevealResponse, ContentLine, ContentPart, Detection, RevealContent } from "./types";
import { displayId } from "../session-id";

/** A detection that can actually place a mask: both wire-only fields present. */
interface Placed {
  start: number;
  end: number;
  maskedAs: string;
}

/**
 * Detections narrowed to the ones that can be laid over `rawPayload`, in document order.
 *
 * `null` — not an empty list — when any detection cannot be placed, because the two are very
 * different outcomes. An event with no detections has nothing to mask and both columns read the
 * same; an event whose detections do not fit the payload is one the console cannot render
 * honestly, and the difference decides whether the modal opens at all.
 */
function place(detections: Detection[], length: number): Placed[] | null {
  const placed: Placed[] = [];
  for (const detection of detections) {
    const { span, maskedAs } = detection;
    // A control plane that reports a finding but not where it fell leaves the masked column
    // unreconstructable. Skipping the detection is not an option — see `toRevealContent`.
    if (!span || maskedAs === undefined) return null;
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end)) return null;
    if (span.start < 0 || span.end > length || span.start >= span.end) return null;
    placed.push({ start: span.start, end: span.end, maskedAs });
  }
  placed.sort((a, b) => a.start - b.start);
  // Overlapping spans have no single masked form — two tokens would claim the same characters,
  // and whichever won would be a choice this module invented.
  for (let i = 1; i < placed.length; i += 1) {
    if (placed[i].start < placed[i - 1].end) return null;
  }
  return placed;
}

/**
 * Cut `payload` into its lines, carrying each line's offset in the whole string so the spans —
 * which index the payload, not the line — can be placed on it.
 *
 * Split on `\n` and keep `\r` off the end: a payload that travelled through a Windows-authored
 * tool would otherwise draw a stray character at every line end, and the offsets stay right
 * either way because the character is dropped from the *rendered* run only.
 */
function lines(payload: string): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = [];
  let at = 0;
  for (const line of payload.split("\n")) {
    out.push({ text: line.endsWith("\r") ? line.slice(0, -1) : line, at });
    at += line.length + 1;
  }
  return out;
}

/** `01`, `02`, … `10` — the design numbers from one and pads to at least two digits. */
const lineNo = (index: number): string => String(index + 1).padStart(2, "0");

/**
 * One line as typed runs. `mark` decides what a detection becomes: the value it covers (the raw
 * column) or the token that replaced it (the masked column).
 */
function toLine(
  line: { text: string; at: number },
  index: number,
  placed: Placed[],
  mark: (value: string, maskedAs: string) => ContentPart
): ContentLine {
  const start = line.at;
  const end = start + line.text.length;
  const parts: ContentPart[] = [];
  let cursor = 0;

  for (const detection of placed) {
    // A span that ends before this line or begins after it belongs to another one. A span that
    // *straddles* the boundary is clipped to the part that falls here, so a detection spanning a
    // newline still masks on both lines rather than being dropped from one of them.
    //
    // The masked column then repeats that detection's token once per line it covers. The
    // alternative — the token on the first line only — would leave the continuation lines
    // rendering as ordinary text, which is the leak this whole module is arranged to prevent.
    // Repeating it keeps the two columns line-for-line, which is what the gutter numbers are for
    // (`ContentLine`), at the cost of one token appearing twice. A truly faithful masked body
    // would have *fewer* lines than the raw one whenever a mask swallowed a newline, and then
    // the columns could not be read against each other at all.
    if (detection.end <= start || detection.start >= end) continue;
    const from = Math.max(detection.start, start) - start;
    const to = Math.min(detection.end, end) - start;
    if (from > cursor) parts.push({ text: line.text.slice(cursor, from) });
    parts.push(mark(line.text.slice(from, to), detection.maskedAs));
    cursor = to;
  }
  if (cursor < line.text.length) parts.push({ text: line.text.slice(cursor) });
  // An empty line still needs a run, or it collapses and the two columns stop lining up — which
  // is the one thing the gutter numbers exist to guarantee.
  if (parts.length === 0) parts.push({ text: "" });

  return { no: lineNo(index), parts };
}

/**
 * The revealed payload and its masked form, or `null` when the masked form cannot be
 * reconstructed faithfully.
 *
 * Declining is deliberate, and it is a leak guard rather than tidiness. The masked column is
 * built by *replacing* detected spans; a detection that cannot be placed is not simply missing
 * from that column — the text it covered falls through as ordinary content, so the pane that is
 * supposed to show what the agent saw would print the secret instead. Everything is placed or
 * nothing is shown.
 *
 * `detections` are the selected event's own (`EventDetail.detections`, off `ApiVerdictDetail`),
 * and their spans index `rawPayload` — the same string, since the gateway stores exactly the
 * text it inspected (`pipeline/types.ts`, verified in GMCP-118).
 */
export function toRevealContent(
  api: ApiRevealResponse,
  detections: Detection[],
  toolName: string
): RevealContent | null {
  const placed = place(detections, api.rawPayload.length);
  if (!placed) return null;

  const rows = lines(api.rawPayload);
  return {
    // What the mock's fixture reads: a short event id and the tool it judged. No case id — see
    // `RevealContent.caseId`.
    source: `${displayId(api.eventId)}  ${toolName}`,
    raw: rows.map((line, index) => toLine(line, index, placed, (value) => ({ secret: value }))),
    masked: rows.map((line, index) => toLine(line, index, placed, (_value, maskedAs) => ({ mask: maskedAs })))
  };
}
