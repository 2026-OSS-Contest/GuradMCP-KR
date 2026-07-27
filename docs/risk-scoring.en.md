# Risk score formula

**English** | [한국어](risk-scoring.md)

Step 5 of the inspection pipeline (Risk Scorer) folds detections and call context into a single 0–100 integer. Policies compare this value in their `risk_score` conditions, and the console Risk Gauge draws the same number. The implementation lives in [`packages/gateway/src/risk.ts`](../packages/gateway/src/risk.ts).

## 1. Formula

```text
score = clamp(0, 100, type base + confidence adjustment + type variety + tool risk + server trust + bulk volume)
```

A payload with no detections scores **0**; the remaining terms are not added. A call in which nothing was found must not become risky through its tool or its server grade alone.

| Term | Value | Rationale |
| --- | --- | --- |
| Type base | `INJECTION` 70 · `SECRET` 60 · `PII` 40 | The highest value among detected types. Injection changes agent behavior, a secret hands over authority, and PII carries disclosure harm. |
| Confidence adjustment | `(peak confidence of that type − 0.8) × 20` | Applies the rule catalog `confidence` around a 0.8 baseline. It does not scale the base, so one low-confidence rule cannot drop a finding out of its type band. |
| Type variety | `(distinct subtypes − 1) × 6`, capped at 12 | Independent signals overlapping make a false positive less likely. |
| Tool risk | high 15 · medium 8 · low 0 | Classified in [`rules/tool-risk.json`](../packages/gateway/src/rules/tool-risk.json). Send, write, delete, and execute are high. |
| Server trust | `untrusted` 18 · `limited` 9 · `trusted` 0 | The same finding is more dangerous from an unverified server. |
| Bulk volume | 15 at 10+ PII spans · 8 at 5+ | FR-PII-05. Raises bulk personal-data disclosure in a single response (T-08). |

## 2. Verdict thresholds

| Band | Range | Meaning |
| --- | --- | --- |
| allow | 0–39 | Pass through |
| warn | 40–69 | Record and pass through |
| approval | 70–89 | Candidate for human approval |
| block | 90–100 | Candidate for blocking |

The thresholds are exported as `riskThresholds` and match the console Risk Gauge ticks. **The score alone never selects an action.** A policy decides, evaluating `risk_score.gte` together with its other match axes. For example, Appendix A.2's `approve_external_email_with_secret` requires approval only when `risk_score.gte: 70` *and* the external-recipient condition both hold.

## 3. Worked examples

Values computed with the checked-in rules and policies.

| Situation | Calculation | Score | Band |
| --- | --- | --- | --- |
| Poisoned tool description (T-04, untrusted response) | 70 + 2 + 12 + 0 + 18 | 100 | block |
| Secret in an external email (Appendix A.2) | 60 + 3 + 6 + 15 + 18 | 100 | block |
| Phone number in an external email | 40 + 3 + 6 + 15 + 18 | 82 | approval |
| One PII span in a customer lookup response | 40 + 2 + 0 + 8 + 18 | 68 | warn |
| Six PII spans in a customer lookup response | 40 + 2 + 0 + 8 + 18 + 8 | 76 | approval |
| The same injection from a trusted server | 70 + 2 + 0 + 8 + 0 | 80 | approval |

Rows two and three are the intended behavior of the `risk_score.gte: 70` policies. Note that a `send_email` recipient address is itself detected as `PII.EMAIL`, so outbound calls start at warn or above even when the body carries nothing else. Internal recipients are filtered by the policy's `to_not_domain` condition.

## 4. Tuning and contribution

- **Tool risk** is adjusted without touching code by adding an entry to [`tool-risk.json`](../packages/gateway/src/rules/tool-risk.json). `match` supports the `*` wildcard and the first matching entry wins. A malformed entry stops the gateway at start-up.
- **Detection confidence** is adjusted through `confidence` in the [detection rule catalogs](../packages/gateway/src/rules/).
- Changing a weight changes policy verdicts, so confirm regressions with `npm run test:unit` and `npm run bench`, and record intended changes with their rationale in the pull request.

## 5. Current limitations

- The gateway does not yet resolve per-server trust grades and evaluates every call as `untrusted`. The grade model arrives with GMCP-64.
- Scoring is rule-based and uses no LLM judge, which keeps the rule pipeline within the NFR-01 latency target.
