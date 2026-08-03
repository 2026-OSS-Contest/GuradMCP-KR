// Tool Description Poisoning defense (GMCP-66, FR-GW-04, threat T-04).
//
// A tools/list response is not data the Agent merely reads — the Agent treats tool
// descriptions as guidance, so an instruction hidden in one is an injection with a
// direct path to behavior. Inspecting the response as a single blob can only answer
// "is something wrong in here", which forces an all-or-nothing block: one poisoned
// tool takes down every honest tool on the server.
//
// So inspect each descriptor on its own and quarantine only the poisoned ones. The
// Agent never sees the malicious text either way; what changes is that the remaining
// tools stay usable and the report names which tool was poisoned.
import { createHash } from "node:crypto";
import { detect, type Detection } from "../detect.js";

/** Everything about a quarantined tool that is safe to hand back to the Agent. */
export interface QuarantinedToolReport {
  /**
   * The tool's own name when it is a plain identifier, otherwise a digest placeholder.
   * An untrusted server can put the injection in `name` itself, so echoing it verbatim
   * would carry the instruction to the Agent through the very report meant to stop it.
   */
  name: string;
  /** Normalized detector tags (`INJECTION.ROLE_OVERRIDE`), never the matched text (NFR-04). */
  detections: string[];
}

/**
 * One quarantine, split into what may leave the gateway and what may not. The report is
 * the only half that reaches the Agent; `detections` and `payload` stay internal so a
 * later edit cannot serialize the injected text into a response by accident.
 */
export interface QuarantineRecord {
  report: QuarantinedToolReport;
  /** This descriptor's own detections — never another tool's (offsets index `payload`). */
  detections: Detection[];
  /** The exact text inspected for this descriptor; the digest source for its event. */
  payload: string;
}

export interface ToolMetadataInspection {
  /** The upstream payload with poisoned descriptors removed. */
  sanitized: unknown;
  quarantined: QuarantineRecord[];
  /**
   * False when the payload carried no recognizable tool list. The caller logs this:
   * an unfamiliar shape means per-tool quarantine silently did nothing, which has to
   * be visible rather than looking like a clean inspection.
   */
  recognized: boolean;
}

/** Tool names the MCP `tools/call` path accepts; anything else is not echoed verbatim. */
const reportableName = /^[a-zA-Z0-9_-]{1,64}$/;

/** Depth ceiling for descriptor traversal, so a hostile nested object cannot spin. */
const maxDepth = 32;

/**
 * Splits a `tools/list` payload into the descriptors that are safe to forward and the
 * ones carrying injection. A payload with no recognizable tool list passes through
 * untouched and is flagged `recognized: false` — the caller still evaluates it under
 * the normal policy path, so an unfamiliar shape is inspected rather than trusted.
 */
export function inspectToolMetadata(upstream: unknown): ToolMetadataInspection {
  const container = findToolsContainer(upstream);
  if (!container) return { sanitized: upstream, quarantined: [], recognized: false };

  const safeTools: unknown[] = [];
  const quarantined: QuarantineRecord[] = [];
  for (const descriptor of container.tools) {
    const payload = inspectableText(descriptor);
    const detections = detect(payload).filter(({ type }) => type === "INJECTION");
    if (detections.length === 0) {
      safeTools.push(descriptor);
      continue;
    }
    quarantined.push({
      report: { name: reportableToolName(descriptor), detections: [...new Set(detections.map(tagOf))] },
      detections,
      payload
    });
  }
  return { sanitized: container.withTools(safeTools), quarantined, recognized: true };
}

/**
 * Accepts both the bare `{ tools }` body and the MCP `{ result: { tools } }` envelope.
 * Missing the envelope would switch the whole defense off against a standards-compliant
 * server — precisely the case it exists for.
 */
function findToolsContainer(upstream: unknown): { tools: unknown[]; withTools: (tools: unknown[]) => unknown } | undefined {
  if (!isRecord(upstream)) return undefined;
  if (Array.isArray(upstream.tools)) {
    const tools = upstream.tools;
    return { tools, withTools: (next) => ({ ...upstream, tools: next }) };
  }
  const result = upstream.result;
  if (isRecord(result) && Array.isArray(result.tools)) {
    const tools = result.tools;
    return { tools, withTools: (next) => ({ ...upstream, result: { ...result, tools: next } }) };
  }
  return undefined;
}

/**
 * Collects the descriptor's string content — every value and key, at any depth — and
 * joins it with real newlines.
 *
 * Inspecting `JSON.stringify(descriptor)` instead would inspect the *serialized* form,
 * where a tab or newline inside a description becomes the two characters `\` and `t`.
 * The injection rules match on `\s+`, so one such character between two words was
 * enough to walk straight past the quarantine. Reading the parsed values removes that
 * class of evasion.
 *
 * Keys are included because a field name is as readable to the Agent as a description,
 * and joining with a newline keeps an instruction split across two fields detectable.
 */
function inspectableText(descriptor: unknown): string {
  return collectStrings(descriptor, 0, []).join("\n");
}

function collectStrings(value: unknown, depth: number, into: string[]): string[] {
  if (depth > maxDepth) return into;
  if (typeof value === "string") {
    into.push(value);
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, depth + 1, into);
    return into;
  }
  if (isRecord(value)) {
    for (const [key, nested] of Object.entries(value)) {
      into.push(key);
      collectStrings(nested, depth + 1, into);
    }
  }
  return into;
}

function reportableToolName(descriptor: unknown): string {
  const name = isRecord(descriptor) && typeof descriptor.name === "string" ? descriptor.name : "";
  if (reportableName.test(name)) return name;
  // Stable per name, so the same poisoned tool stays recognizable across events without
  // the name itself ever being repeated back.
  return `(unreportable name #${createHash("sha256").update(name).digest("hex").slice(0, 8)})`;
}

function tagOf({ type, subtype }: Detection): string {
  return subtype ? `${type}.${subtype}` : type;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
