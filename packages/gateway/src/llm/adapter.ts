// FR-INJ-04 (GMCP-57): the seam a second-opinion classifier plugs into.
//
// This file deliberately contains no vendor, no HTTP client and no API key handling.
// The adjudicator (./adjudicator.ts) depends on this interface alone, which is what
// lets the feature ship default-off with no hard dependency: with no adapter
// registered there is nothing to construct, nothing to configure and no import of a
// provider SDK anywhere in the gateway's module graph.

/** What the classifier was asked about. Never the raw payload — see {@link AdjudicationRequest}. */
export type AdjudicationLabel = "injection" | "benign" | "unsure";

export interface AdjudicationRequest {
  /**
   * The text to classify. This is the one place the gateway hands payload text to
   * an outside service, so enabling an adapter is a disclosure decision as much as a
   * detection one — `docs/llm-adjudicator.md` states that plainly, and it is why the
   * feature is off unless an operator turns it on.
   */
  text: string;
  /** Rule-stage verdict this is a second opinion on, for prompts that want the context. */
  ruleRiskScore: number;
  /** Aborts when the adjudicator's budget expires; an adapter must honour it. */
  signal: AbortSignal;
}

export interface AdjudicationResult {
  label: AdjudicationLabel;
  /** 0–1. An adapter that cannot express confidence should report its label with 1. */
  confidence: number;
}

export interface LlmAdapter {
  /** Identifies the model in events and metrics, e.g. `gemma-3-4b`. Never a key or an endpoint. */
  readonly name: string;
  classify(request: AdjudicationRequest): Promise<AdjudicationResult>;
}

let registered: LlmAdapter | null = null;

/**
 * Registers the adapter to adjudicate with. Called by an operator's own bootstrap
 * code, not by the gateway: shipping a default would make one vendor the implicit
 * answer and undo the isolation this indirection exists for.
 */
export function registerLlmAdapter(adapter: LlmAdapter): void {
  registered = adapter;
}

export function activeLlmAdapter(): LlmAdapter | null {
  return registered;
}

/** Test-only reset; production registers once at boot. */
export function resetLlmAdapter(): void {
  registered = null;
}
