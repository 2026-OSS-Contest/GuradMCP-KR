# Optional LLM adjudicator

**English** | [한국어](llm-adjudicator.md)

An opt-in plugin that asks a small model for a second opinion **only on the borderline band**, where the rule detectors are least certain (FR-INJ-04). **It is off by default.**

## Why it is off by default

Turning it on **sends inspected text to an outside model**. That makes it a disclosure decision before it is a detection one. An operator has to know what leaves and where it goes, so the default is off and no adapter ships with the gateway.

Dependency isolation follows from the same choice. With the feature off, no adapter is constructed and no provider SDK enters the gateway's module graph at all. **"No hard dependency" is structural here, not configural.**

## Turning it on

Both steps are required; either one alone does nothing.

```bash
export LLM_ADJUDICATOR_ENABLED=true
```

Then register an adapter from your own bootstrap code.

```ts
import { registerLlmAdapter } from "@guardmcp/gateway/llm/adapter.js";

registerLlmAdapter({
  name: "gemma-3-4b",              // the name that lands in events — never a key or an endpoint
  async classify({ text, ruleRiskScore, signal }) {
    // Call your model here. Pass `signal` through.
    return { label: "injection", confidence: 0.9 };
  },
});
```

No default adapter is deliberate: shipping one would make a single vendor the implicit answer and undo the isolation this indirection exists for.

## When it is called

| Risk score | Behaviour |
| --- | --- |
| 0–39 | Not called — the rules found nothing |
| **40–69** | **Called** — the borderline band |
| 70+ | Not called — the pipeline already escalates to approval or stronger |

Nothing is asked above 70 because that **spends latency and disclosure to confirm a decision being made anyway**. The band lives in `packages/gateway/src/rules/llm-adjudicator.json`.

## It can escalate, never soften

This is the feature's most important property.

- A confident `injection` answer raises the verdict to **`require_approval`**.
- A `benign` or `unsure` answer leaves the rule verdict **exactly as it was**.

It cannot lower one because a wrong answer — or a compromised adapter — must not be able to talk the gateway out of a block it had already decided on. The model is a reason to put a human in front of a borderline call, not a reason to decide it.

The bar is `minConfidence` (0.7 by default). A less confident accusation is recorded and ignored.

## When the adapter fails

On timeout, exception or a malformed answer, **the rule verdict stands and the request continues.** The attempt is still recorded.

```json
{ "model": "gemma-3-4b", "label": "unsure", "confidence": 0,
  "latencyMs": 801, "escalated": false, "failure": "timeout" }
```

A second opinion that can take the gateway down with it is not optional. The budget is 800ms, adjustable via `timeoutMs`.

## Latency is reported separately

`latencyMs` is **not** folded into the rule pipeline's timing. NFR-01's budget is a claim about the rules, and a network call to somebody else's model hiding inside it would make that claim meaningless. It rides on the GuardEvent as its own `llmAdjudication` field.

## Known limits

- Tool-description scanning (the `tools/list` quarantine path) is synchronous and does not run the adjudicator. That is a separate surface and out of this ticket's scope.
- There is no cost accounting. The adapter is the only party that knows what a call costs, so metering belongs there if you need it.
