# Korean service credentials

**English** | [한국어](korean-service-tokens.md)

Plenty of tools catch a GitHub token or an AWS key. What they all miss is **domestic service credentials** — a Toss Payments secret key can travel out inside a support log and no foreign scanner says a word. This catalog fills that gap (FR-SEC-02).

Everything it detects masks to a single tag: `[KR_SERVICE_TOKEN]`.

## The catalog

The source of truth is [`packages/gateway/src/rules/korean-service-tokens.json`](../packages/gateway/src/rules/korean-service-tokens.json).

| ID | Service | Credential | Match | Confidence |
| --- | --- | --- | --- | --- |
| `TOSS_SECRET_KEY` | Toss Payments | Secret key | signature | 0.95 |
| `TOSS_CLIENT_KEY` | Toss Payments | Client key | signature | 0.85 |
| `KAKAO_ADMIN_HEADER` | Kakao | REST API key (Authorization header) | signature | 0.95 |
| `KAKAO_APP_KEY` | Kakao | App key (REST, JavaScript, Admin) | context | 0.85 |
| `NCP_ACCESS_KEY` | NAVER Cloud Platform | Sub-account access key | signature | 0.9 |
| `NAVER_CLIENT_SECRET` | NAVER Developers | Client secret | context | 0.9 |
| `BROKERAGE_APP_SECRET` | Korean brokerage Open API | App secret | context | 0.8 |

## Signature versus context

A **signature** entry recognizes the credential by its own shape. Prefixes like `test_sk_`, `live_sk_`, and `ncp_iam_` belong to one vendor, so no surrounding text is needed.

A **context** entry needs a keyword beside the value, because the value alone is indistinguishable from an ordinary identifier. A Kakao app key is 32 lowercase hex characters — **exactly what an MD5 digest looks like.** Matching the bare value would report every checksum in every log as a credential. So that entry requires an assignment such as `kakao_rest_api_key = …`, and a separate signature entry covers the header form.

The lower an entry's confidence, the more it leans on context, and the more likely a reshaped leak slips past it. `BROKERAGE_APP_SECRET` is the weakest entry here: Korean brokerage Open API keys carry no vendor prefix, so there is nothing to key on but the field name. That is the first thing worth improving.

## Adding a service

**No TypeScript change is required.** Append one entry to the JSON.

```json
{
  "id": "MY_SERVICE_API_KEY",
  "service": "Service name",
  "credential": "What kind of credential this is",
  "match": "signature",
  "pattern": "\\bmysvc_[A-Za-z0-9]{24,}\\b",
  "flags": "g",
  "confidence": 0.9,
  "basis": "Why the pattern has this shape, and where you confirmed it"
}
```

`basis` records the **evidence**, not the format. Without it nobody can tell a verified vendor format from a guess, which is what makes the file contributable at all — so it is mandatory, and the gateway refuses to start if it is missing.

Then add samples to [`attack-lab/datasets/korean-service-tokens.json`](../attack-lab/datasets/korean-service-tokens.json). **A positive sample must name your new `id` in `credential`**, and a negative sample belongs with it.

```json
{"id": "kst-15", "label": true, "credential": "MY_SERVICE_API_KEY", "text": "The config carries mysvc_ABCdef0123456789ABCdef01."},
{"id": "kst-n11", "label": false, "text": "I read the mysvc documentation on authentication."}
```

Values must be **synthetic**. Never paste a key you actually hold, even one that only looks right.

```bash
npm run test:unit && npm run bench
```

## Measurement

`npm run bench` scores recall and false-positive rate over this dataset and records them under `koreanServiceTokens` in the report. It is measured **separately from PII recall**: folding the two together would let a strong PII score hide a domestic credential the detector stopped recognizing, which inverts the reason this file exists.

| Metric | Threshold |
| --- | --- |
| `koreanServiceTokenRecall` | ≥ 0.90 |
| `koreanServiceTokenFpr` | ≤ 0.05 |

A positive sample must trip **the entry it names**. A lucky match from some other rule does not count, so renaming an entry without updating the dataset fails here.

## Limits

- A credential with no prefix is missed when it travels without its field name. That is the structural cost of a context entry.
- A token wrapped in another layer of base64 is not caught; the de-obfuscation pass re-runs injection rules only (see [obfuscation preprocessing](obfuscation.en.md)).
- The brokerage entry leans on one vendor's field-naming convention and may not match other brokerages.
