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
import { detect, type Detection } from "../detect.js";

export interface QuarantinedTool {
  name: string;
  /** Normalized detector tags (`INJECTION.ROLE_OVERRIDE`), never the matched text (NFR-04). */
  detections: string[];
}

export interface ToolMetadataInspection {
  /** The upstream payload with poisoned descriptors removed. */
  sanitized: unknown;
  quarantined: QuarantinedTool[];
  /** Detections found across every quarantined descriptor, for the recorded event. */
  detections: Detection[];
}

/**
 * Splits a `tools/list` payload into the descriptors that are safe to forward and the
 * ones carrying injection. A payload that is not a recognizable tool list passes
 * through untouched — the caller still evaluates it under the normal policy path, so
 * an unfamiliar shape is inspected rather than silently trusted.
 */
export function inspectToolMetadata(upstream: unknown): ToolMetadataInspection {
  if (!isRecord(upstream) || !Array.isArray(upstream.tools)) {
    return { sanitized: upstream, quarantined: [], detections: [] };
  }
  const safeTools: unknown[] = [];
  const quarantined: QuarantinedTool[] = [];
  const detections: Detection[] = [];
  for (const descriptor of upstream.tools) {
    const found = injectionsIn(descriptor);
    if (found.length === 0) {
      safeTools.push(descriptor);
      continue;
    }
    quarantined.push({ name: toolNameOf(descriptor), detections: [...new Set(found.map(tagOf))] });
    detections.push(...found);
  }
  return { sanitized: { ...upstream, tools: safeTools }, quarantined, detections };
}

/**
 * Inspects the whole descriptor, not just `description`: the name, parameter
 * descriptions, and any vendor field are equally readable by the Agent, so a rule that
 * only looked at one field would just move the hiding place.
 */
function injectionsIn(descriptor: unknown): Detection[] {
  return detect(JSON.stringify(descriptor) ?? "").filter(({ type }) => type === "INJECTION");
}

function toolNameOf(descriptor: unknown): string {
  if (isRecord(descriptor) && typeof descriptor.name === "string" && descriptor.name.length > 0) {
    return descriptor.name;
  }
  return "(unnamed tool)";
}

function tagOf({ type, subtype }: Detection): string {
  return subtype ? `${type}.${subtype}` : type;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
