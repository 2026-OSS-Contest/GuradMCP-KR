import type { ApiApproval, Approval, ContentPart, RawPart } from "./types";

/**
 * Narrows the three pre-decision evidence fields on an approval.
 *
 * `ApprovalStore.kt` holds `riskTags: List<Any?>?` and `maskPreview: Any?` — Jackson's generic
 * tree. The store says why in its own doc comment: it has "no reason to interpret their shape,
 * only to hold and later clear it". So the control plane will hand back whatever the gateway put
 * in, unvalidated, and the console is the first thing in the chain that assumes a shape.
 *
 * Every check here therefore fails by **dropping the field**, never by throwing and never by
 * substituting a placeholder. A card missing its chips still shows the tool, the arguments and
 * the reason it was held — which is enough to decide on — whereas a card that renders `undefined`
 * as a risk tag, or a mask preview with half its lines silently missing, is worse than one that
 * admits it has nothing to show. SCR-402's panes already degrade on absence for that reason.
 */
export function toApproval(raw: ApiApproval): Approval {
  return {
    ...raw,
    riskTags: riskTags(raw.riskTags),
    threatScore: threatScore(raw.threatScore),
    maskPreview: maskPreview(raw.maskPreview),
  };
}

export const toApprovals = (raw: ApiApproval[]): Approval[] => raw.map(toApproval);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * `SECRET 1건` chips. A tag needs both halves to say anything: a type with no count cannot be
 * rendered as "N건", and a count with no type names nothing. Partial tags are dropped
 * individually, so one malformed entry does not cost the reader the rest of the evidence.
 */
function riskTags(value: unknown): Approval["riskTags"] {
  if (!Array.isArray(value)) return undefined;
  const tags = value.flatMap((tag) =>
    isRecord(tag) && typeof tag.type === "string" && Number.isFinite(tag.count)
      ? [{ type: tag.type, count: Number(tag.count) }]
      : [],
  );
  return tags.length > 0 ? tags : undefined;
}

/** 0–100, shown as a gauge. Out-of-range means the sender is not measuring what we draw. */
function threatScore(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : undefined;
}

/**
 * The 마스킹 미리보기 panes. Both sides are required: the panel's whole claim is "this is what
 * would go out, and this is what would replace it", and one pane alone makes a comparison the
 * reader cannot complete.
 */
function maskPreview(value: unknown): Approval["maskPreview"] {
  if (!isRecord(value)) return undefined;
  const raw = lines(value.raw, rawPart);
  const masked = lines(value.masked, contentPart);
  return raw && masked ? { raw, masked } : undefined;
}

/**
 * A pane's numbered lines. Unlike a risk tag, a dropped line is not survivable: the numbers down
 * the gutter are how the two panes are read against each other, so a preview missing line 3 shows
 * a diff that never existed. One bad line voids the pane.
 */
function lines<P>(value: unknown, part: (value: unknown) => P | undefined): { no: string; parts: P[] }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: { no: string; parts: P[] }[] = [];
  for (const line of value) {
    if (!isRecord(line) || typeof line.no !== "string" || !Array.isArray(line.parts)) return undefined;
    const parts: P[] = [];
    for (const candidate of line.parts) {
      const parsed = part(candidate);
      if (parsed === undefined) return undefined;
      parts.push(parsed);
    }
    out.push({ no: line.no, parts });
  }
  return out;
}

/**
 * A run of the Raw pane. `sensitive` carries the **actual value**, which is the point of this
 * pane and the reason NFR-04 only lets it exist while the approval is pending.
 */
function rawPart(value: unknown): RawPart | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.text === "string") return { text: value.text };
  if (typeof value.sensitive === "string") return { sensitive: value.sensitive };
  return undefined;
}

/** A run of the masked pane, where `mask` is the label (`PHONE`) standing in for a value. */
function contentPart(value: unknown): ContentPart | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.text === "string") return { text: value.text };
  if (typeof value.mask === "string") return { mask: value.mask };
  if (typeof value.secret === "string") return { secret: value.secret };
  return undefined;
}
