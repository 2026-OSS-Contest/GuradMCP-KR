# Risk score formula

**English** | [한국어](risk-scoring.md)

Step 5 of the inspection pipeline (Risk Scorer) folds detections and call context into a single 0–100 integer. Policies compare this value in their `risk_score` conditions, and the console Risk Gauge draws the same number. The implementation lives in [`packages/gateway/src/risk.ts`](../packages/gateway/src/risk.ts).

## 1. Formula

```text
base_score = clamp(0, 100, type base + confidence adjustment + type variety + tool risk + bulk volume)
score = clamp(0, 100, round(base_score × trust_multiplier))
```

A payload with no detections scores **0**; the remaining terms are not added, and `trust_multiplier` is not applied either. A call in which nothing was found must not become risky through its tool or its server grade alone.

| Term | Value | Rationale |
| --- | --- | --- |
| Type base | `INJECTION` 70 · `SECRET` 60 · `PII` 40 | The highest value among detected types. Injection changes agent behavior, a secret hands over authority, and PII carries disclosure harm. |
| Confidence adjustment | `(peak confidence of that type − 0.8) × 20` | Applies the rule catalog `confidence` around a 0.8 baseline. It does not scale the base, so one low-confidence rule cannot drop a finding out of its type band. |
| Type variety | `(distinct subtypes − 1) × 6`, capped at 12 | Independent signals overlapping make a false positive less likely. |
| Tool risk | high 15 · medium 8 · low 0 | Classified in [`rules/tool-risk.json`](../packages/gateway/src/rules/tool-risk.json). Send, write, delete, and execute are high. |
| Bulk volume | 15 at 10+ PII spans · 8 at 5+ | FR-PII-05. Raises bulk personal-data disclosure in a single response (T-08). |

**Server trust (FR-GW-02)** is not an addend — it multiplies `base_score`. Values are externalized to [`rules/risk-weights.json`](../packages/gateway/src/rules/risk-weights.json).

| trustLevel | trust_multiplier | Rationale |
| --- | --- | --- |
| `trusted` | ×1.0 | A server the operator explicitly verified. No reduction (default). |
| `limited` | ×1.3 | Partially trusted server. Adds 30% to the detection score. |
| `untrusted` | ×1.6, plus a floor (`untrustedHighRiskFloor`, default 70) for high-risk tools (send/write/delete/exec — reusing `tool-risk.json`'s `high` classification) | Data returned by an external/unverified server is a likely starting point for a T-01/T-06 path. The floor only guards against a weak-confidence finding scaling below the floor — it never applies when nothing was detected (score stays 0). |

The lookup that resolves a server's actual trust grade (the gateway's server-registry cache, synced from the Control Plane) was added in GMCP-64. The gateway never blocks a verdict on a live Control Plane round-trip — it reads its local cache — and a cache miss (a new or not-yet-synced server) fails safe to `untrusted`.

## 2. Verdict thresholds

| Band | Range | Meaning |
| --- | --- | --- |
| allow | 0–39 | Pass through |
| warn | 40–69 | Record and pass through |
| approval | 70–89 | Candidate for human approval |
| block | 90–100 | Candidate for blocking |

The thresholds are exported as `riskThresholds` and match the console Risk Gauge ticks. **The score alone never selects an action.** A policy decides, evaluating `risk_score.gte` together with its other match axes. For example, Appendix A.2's `approve_external_email_with_secret` requires approval only when `risk_score.gte: 70` *and* the external-recipient condition both hold.

## 3. Worked examples

Values computed with the checked-in rules, policies, and weight config.

| Situation | base_score calculation | base_score | trust_multiplier | Final score | Band |
| --- | --- | --- | --- | --- | --- |
| Poisoned tool description (T-04, untrusted response) | 70 + 2 + 0 + 0 + 0 | 72 | ×1.6 | 100 (clamped) | block |
| Secret in an external email, untrusted server (Appendix A.2) | 60 + 3 + 0 + 15 + 0 | 78 | ×1.6 | 100 (clamped) | block |
| Phone number in an external email, untrusted server | 40 + 2 + 0 + 15 + 0 | 57 | ×1.6 | 91 | block |
| Phone number in an external email, limited server | 40 + 2 + 0 + 15 + 0 | 57 | ×1.3 | 74 | approval |
| One PII span in a customer lookup response, untrusted server | 40 + 2 + 0 + 8 + 0 | 50 | ×1.6 | 80 | approval |
| Six PII spans in a customer lookup response, untrusted server | 40 + 2 + 0 + 8 + 8 | 58 | ×1.6 | 93 | block |
| The same injection from a trusted server | 70 + 2 + 0 + 0 + 0 | 72 | ×1.0 | 72 | approval |

The same finding lands in a different band purely from a server-trust change (compare rows 4 and 5). Note that a `send_email` recipient address is itself detected as `PII.EMAIL`, so outbound calls start at warn or above even when the body carries nothing else. Internal recipients are filtered by the policy's `to_not_domain` condition.

## 4. Tuning and contribution

- **Tool risk** is adjusted without touching code by adding an entry to [`tool-risk.json`](../packages/gateway/src/rules/tool-risk.json). `match` supports the `*` wildcard and the first matching entry wins. A malformed entry stops the gateway at start-up.
- **Server-trust multiplier/floor** is adjusted without touching code in [`risk-weights.json`](../packages/gateway/src/rules/risk-weights.json). The starting values (×1.0/×1.3/×1.6, floor 70) can move with benchmark results.
- **Detection confidence** is adjusted through `confidence` in the [detection rule catalogs](../packages/gateway/src/rules/).
- Changing a weight changes policy verdicts, so confirm regressions with `npm run test:unit` and `npm run bench`, and record intended changes with their rationale in the pull request.

## 5. Current limitations

- Trust grades are assigned manually by an operator (GMCP-64 scope). Automatic grading (e.g. server reputation scoring) is not covered.
- There is no logic yet that traces and blocks the call *chain* itself — "a low-trust tool's response steering a high-trust tool call." Each call is still judged independently, from its own target server's trust grade and tool risk (see the [policy guide](policy-guide/README.en.md#33-server_trust) for the shipped example policy).
