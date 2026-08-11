# High-entropy credential safety net

**English** | [한국어](high-entropy-secrets.md)

`secret.json` and the [Korean service credential catalog](korean-service-tokens.en.md) recognize credentials by **shape**, which only works for shapes somebody already wrote down. This pass is the net under the ones nobody did: an internal service token, a rotated format, a vendor the catalog has never heard of (FR-SEC-03).

A match is reported as `SECRET.HIGH_ENTROPY` and masked as `[SECRET]`.

## Entropy does not decide this on its own

This is the important part.

**A SHA-256 digest, a UUID, a commit hash, and a minified bundle are all high-entropy, and none of them is a credential.** A bare entropy threshold reports every line of a build log, and a detector like that gets turned off — at which point it protects nothing.

What separates a credential from a digest is not the value. It is that somebody named the field `token` rather than `checksum`.

So the decision has two stages.

| Stage | What it looks at |
| --- | --- |
| **① Field name** | Does something introduce this as a credential (`api_key`, `token`, `client_secret`, `Authorization`)? |
| **② Entropy** | Does the value look **generated** rather than **typed**? |

① decides candidacy; ② only filters the candidates. The order cannot be reversed.

## Thresholds

The source of truth is [`packages/gateway/src/rules/entropy.json`](../packages/gateway/src/rules/entropy.json).

| Setting | Value | Why |
| --- | --- | --- |
| Minimum length | 20 chars | Shannon entropy over a handful of characters is noise |
| Maximum length | 200 chars | Beyond that it is a data blob, not a credential |
| Threshold (hex) | 3.6 bits/char | 16 symbols tops out near 4.0; the general bar would exempt every hex-encoded credential |
| Threshold (other) | 4.0 bits/char | base64 and mixed alphanumerics draw from 64 symbols and can carry a higher bar |
| Confidence | 0.6 | Below every catalogued rule |

**Why 0.6:** this pass says *"this is shaped like a credential and is introduced as one"*, not *"this is a GitHub token"*. A catalogued rule (0.85–0.99) has far more specific evidence and should outrank it.

## It yields to catalogued rules

A span a catalogued rule already covers is **not** reported again.

```
OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz1234
                └─ already SECRET.LLM_API_KEY
```

Counting the same value twice inflates the risk score, and worse, hands `mask()` two overlapping ranges to replace. When a specific rule exists, it is right.

## The field-name list

What is **left out** matters as much as what is in.

`hash`, `checksum`, `digest`, `sha`, `commit`, `etag`, `id`, `uuid` — all name high-entropy values, and none of them is a credential. Adding them is exactly how an entropy rule starts reporting build logs.

Field names are recognized through a prefix, so `INTERNAL_API_KEY` and `legacy_secret_key` match — the shapes credentials most often take in real configuration.

## Adding a field name

No TypeScript change is needed: add a regex fragment to `fields.keywords` in [`entropy.json`](../packages/gateway/src/rules/entropy.json).

When you add one, **add a negative sample with it** to [`attack-lab/datasets/high-entropy-secrets.json`](../attack-lab/datasets/high-entropy-secrets.json). There is always a sentence that uses the name without carrying a credential.

```bash
npm run test:unit && npm run bench
```

## Measurement

`npm run bench` records the result under `highEntropySecrets`.

| Metric | Threshold |
| --- | --- |
| `highEntropyRecall` | ≥ 0.90 |
| `highEntropyFpr` | ≤ 0.05 |

**The false-positive rate is the number this feature lives or dies by.** A net with slightly low recall is still a net; a noisy one gets switched off and then it catches nothing. It is scored separately from the PII and Korean-token metrics for the same reason — a good score elsewhere would hide this one going bad.

## Limits

- **No field name, no detection.** A credential floating in prose without anything introducing it is never even a candidate; that case belongs to the catalogued rules.
- **A human-chosen password is missed.** Its entropy is low, so it passes — that is a policy and operations problem, not this pass's.
- A value wrapped in another layer of base64 is missed; the de-obfuscation pass re-runs injection rules only (see [obfuscation preprocessing](obfuscation.en.md)).
