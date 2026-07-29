# Obfuscation preprocessing

**English** | [한국어](obfuscation.md)

Hidden instructions do not always arrive as plain text. Encode the same sentence, or break it up with invisible characters, and pattern matching alone lets it through (threat T-07). The detector reverses these transforms before it inspects.

## What is undone

| Transform | Handling | Implementation |
| --- | --- | --- |
| Unicode compatibility characters (e.g. `ﬁ`) | NFKC normalization | `normalizeInput` |
| Zero-width characters (U+200B–U+200D, U+FEFF) | stripped | `normalizeInput` |
| Base64-encoded blocks | decoded, then re-scanned with the injection rules | `findEncodedInjections` |

Normalization **keeps a mapping back to the original offsets**, so a detection found in the transformed string still masks the exact span of the original.

## Base64 decoding

Encoded runs are decoded and re-scanned with the injection rules. When a rule matches, the **entire encoded run** is reported as one detection.

```text
input   참고 자료: SWdub3JlIGFsbCBwcmV2aW91cyBpbnN0cnVjdGlvbnMg...
detects INJECTION.OBFUSCATED
masked  참고 자료: [INJECTION]
```

- **The span points at the encoded run.** Masking replaces the whole blob, so the decoded instruction reaches neither the caller nor the event record (NFR-04).
- **The subtype is `OBFUSCATED`.** The default pack's `block_untrusted_injection_response` already lists `INJECTION.OBFUSCATED` among its match tags, so this makes an existing policy axis real rather than adding a parallel one.
- **False positives:** `atob` rejects malformed base64 and a fatal `TextDecoder` rejects non-UTF-8 bytes, so hashes, binaries, and image data drop out. Even a clean decode is reported only when an **injection rule matches** — encoded JSON or an ordinary sentence is not flagged.

### Bounds

| Setting | Value | Reason |
| --- | --- | --- |
| Minimum candidate length | 24 chars | skips short tokens that merely look like base64 |
| Maximum candidate length | 4,096 chars | caps latency from decoding a huge block |
| Maximum decodes per payload | 16 | cost ceiling; a hidden instruction is short |

## Latency impact (NFR-01)

Measured over 300 iterations on a 10KB payload against the p95 ≤ 50ms budget.

| Payload | p95 before | p95 after | Delta |
| --- | --- | --- | --- |
| Benchmark default (10KB, no base64) | 0.131ms | 0.131ms | within measurement noise |
| Contains base64 blocks (10KB) | 0.162ms | 0.314ms | **+0.15ms** |

Even in the worst case the pass uses roughly **0.6% of the budget**. A payload with no base64 has no candidates and costs nothing.

The implementation lives in [`packages/gateway/src/detect.ts`](../packages/gateway/src/detect.ts); the attack samples are `T-07-b` (encoded attack) and `T-07-c` (benign base64 control) in [`attack-lab/scenarios/threats.json`](../attack-lab/scenarios/threats.json).
