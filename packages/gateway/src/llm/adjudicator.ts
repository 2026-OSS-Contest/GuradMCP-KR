// FR-INJ-04 (GMCP-57): an opt-in second opinion on borderline payloads.
//
// Three properties this is built around, in the order they constrain the design:
//
// 1. Off by default, with no hard dependency. Nothing here runs, and no adapter is
//    constructed, unless an operator sets LLM_ADJUDICATOR_ENABLED=true *and*
//    registers an adapter. The rule pipeline is untouched either way — the sync
//    `evaluatePayload` still produces the verdict, and this only ever runs after it.
// 2. It can escalate, never soften. A model that answers "benign" leaves the rule
//    verdict exactly as it was. Otherwise a wrong answer — or a compromised adapter —
//    would be able to talk the gateway out of a block it had already decided on.
// 3. Every run reports its own latency, separately from the rule pipeline's, because
//    NFR-01's budget is a claim about the rules and must not silently absorb a
//    network call to somebody else's model.
import config from "../rules/llm-adjudicator.json" with { type: "json" };
import { activeLlmAdapter, type AdjudicationLabel } from "./adapter.js";

export interface AdjudicationRecord {
  /** Adapter name, so an event says which model answered. */
  model: string;
  label: AdjudicationLabel;
  confidence: number;
  /** Wall-clock milliseconds this took, excluded from the rule pipeline's timing. */
  latencyMs: number;
  /** True when the adjudication changed the verdict rather than merely agreeing with it. */
  escalated: boolean;
  /** Set when the adapter timed out, threw, or answered malformed; the rule verdict stands. */
  failure?: "timeout" | "error" | "malformed";
}

const band = { gte: config.band.gte, lt: config.band.lt };
const timeoutMs = config.timeoutMs;
const minConfidence = config.minConfidence;

/** Read per call, not at module load, so a test can toggle it without re-importing. */
function enabled(): boolean {
  return process.env.LLM_ADJUDICATOR_ENABLED === "true";
}

/**
 * Whether a rule verdict is borderline enough to be worth a second opinion. Exported
 * so the caller can skip building a request — and skip touching the payload text at
 * all — for the scores that will never be adjudicated.
 */
export function isBorderline(riskScore: number): boolean {
  return riskScore >= band.gte && riskScore < band.lt;
}

export function adjudicationEnabled(): boolean {
  return enabled() && activeLlmAdapter() !== null;
}

/**
 * Returns the record to attach to the event, or `null` when nothing ran. A `null`
 * return is the normal case: the feature is off, no adapter is registered, or the
 * score was never borderline.
 */
export async function adjudicate(text: string, ruleRiskScore: number): Promise<AdjudicationRecord | null> {
  const adapter = activeLlmAdapter();
  if (!enabled() || !adapter || !isBorderline(ruleRiskScore)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const result = await adapter.classify({ text, ruleRiskScore, signal: controller.signal });
    const latencyMs = performance.now() - startedAt;
    if (!isLabel(result?.label) || !isConfidence(result?.confidence)) {
      return { model: adapter.name, label: "unsure", confidence: 0, latencyMs, escalated: false, failure: "malformed" };
    }
    // Only a confident "injection" moves anything. "benign" and "unsure" are recorded
    // and discarded — see property 2 above.
    const escalated = result.label === "injection" && result.confidence >= minConfidence;
    return { model: adapter.name, label: result.label, confidence: result.confidence, latencyMs, escalated };
  } catch {
    const latencyMs = performance.now() - startedAt;
    const failure = controller.signal.aborted ? "timeout" : "error";
    // A failing adapter must not fail the request: an optional second opinion that can
    // take the gateway down with it is not optional.
    return { model: adapter.name, label: "unsure", confidence: 0, latencyMs, escalated: false, failure };
  }
  finally {
    clearTimeout(timer);
  }
}

function isLabel(value: unknown): value is AdjudicationLabel {
  return value === "injection" || value === "benign" || value === "unsure";
}

function isConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
