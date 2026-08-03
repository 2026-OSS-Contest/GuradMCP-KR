# Verdict explanations

**English** | [한국어](explanation.md)

Every guard event the gateway emits carries a human-readable reason for its verdict. A policy's `message` is optional author prose and may be absent, so the reason a reader actually needs — verdict, deciding policy, severity, evidence — is composed by the gateway instead.

## Shape

```json
{
  "reasonCode": "BLOCK_ENV_FILE_READ",
  "ko": "차단했습니다 — 정책 block_env_file_read (심각도 critical). 탐지 SECRET.LLM_API_KEY 1건, 위험 점수 96.",
  "en": "Blocked — policy block_env_file_read (severity critical). Detected SECRET.LLM_API_KEY ×1, risk score 96."
}
```

| Field | Meaning |
| --- | --- |
| `reasonCode` | locale-independent machine key |
| `ko` | Korean sentence (the console's default locale) |
| `en` | English sentence for the same verdict |

Both languages ship together, so the console can pick the one matching its locale without a second lookup.

## Writing rules (proposal §10.6)

1. **State the verdict as fact.** Every verdict uses the same shape: `Blocked — policy block_env_file_read (severity critical)`.
2. **Do not inflate.** No exclamation marks, no fear appeals, no adjectives that exaggerate the finding.
3. **Never translate technical identifiers.** Policy IDs and detector tags (`SECRET`, `PII.PHONE`) stay verbatim.

## Evidence

Evidence is limited to **per-tag counts and the risk score**. Tags keep their subtype — `PII.RRN_LIKE` and `PII.PHONE` call for different responses, so collapsing both to `PII` would drop the part a reader acts on. Matched text never appears in either locale (NFR-04). When nothing matched, the sentence says so plainly — `no policy matched, pack default action`.

## Wording per verdict

| Verdict | English | 한국어 |
| --- | --- | --- |
| `block` | Blocked | 차단했습니다 |
| `require_approval` | Waiting for approval | 승인을 기다립니다 |
| `mask_then_allow` | Masked, then forwarded | 마스킹 후 전달했습니다 |
| `warn` | Warned and forwarded | 경고를 기록하고 통과시켰습니다 |
| `allow` | Allowed | 통과시켰습니다 |

The sentence describes **the verdict the router actually reached**, and why. An approval that times out reads `Blocked (the approval timed out)`: the same `block` verdict means something different when a policy demanded it than when nobody answered in time.

## Naming the deciding policy

When more than one policy matches, the sentence names the policy that **decided**. `matchedPolicyIds` is the full list in priority order, so its first element is often not the one `severity-max` adopted — and `severity`, `reasonCode`, and `message` all come from the deciding policy, so naming the first element would contradict the rest of the same event. Remaining matches are only counted.

## Delivery scope (current limit)

The explanation rides on **events the gateway emits**. The Control Plane's `GuardEvent` (the Replay timeline DTO), the `audit_events` table, and the OpenAPI schema do not carry the field yet. The audit-logging pipeline that forwards gateway events to the Control Plane is itself being built in GMCP-24, so carrying the field across belongs to that work.

The implementation lives in [`packages/gateway/src/pipeline/explanation.ts`](../packages/gateway/src/pipeline/explanation.ts).
