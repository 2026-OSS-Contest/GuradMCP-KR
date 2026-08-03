# Obfuscation preprocessing

**English** | [한국어](obfuscation.md)

Hidden instructions do not always arrive as plain text. Encode the same sentence, or break it up with invisible characters, and pattern matching alone lets it through (threat T-07). The detector reverses these transforms before it inspects.

## What is undone

| Transform | Handling | Implementation |
| --- | --- | --- |
| Unicode compatibility characters (e.g. `ﬁ`) | NFKC normalization | `normalizeInput` |
| Zero-width characters (U+200B–U+200D, U+FEFF) | stripped | `normalizeInput` |
| Base64-encoded blocks (including base64url) | decoded, then re-scanned with the injection rules | `findEncodedInjections` |

Normalization **keeps a mapping back to the original offsets**, so a detection found in the transformed string still masks the exact span of the original.

## Base64 decoding

Encoded runs are decoded and re-scanned with the injection rules. When a rule matches, the **entire encoded run** is reported as one detection.

The pass reads the **normalized** text. Reading the raw input meant a single zero-width character inside a blob split the run and hid the instruction from the one pass that exists to reveal it. Spans are mapped back to original offsets through the same path the rules use.

```text
input   참고 자료: SWdub3JlIGFsbCBwcmV2aW91cyBpbnN0cnVjdGlvbnMg...
detects INJECTION.OBFUSCATED
masked  참고 자료: [INJECTION]
```

- **The span points at the encoded run.** Masking replaces the whole blob, so the decoded instruction reaches neither the caller nor the event record (NFR-04).
- **The subtype is `OBFUSCATED`.** The default pack's `block_untrusted_injection_response` already lists `INJECTION.OBFUSCATED` among its match tags, so this makes an existing policy axis real rather than adding a parallel one.
- **Alignment and length:** a run is swept end to end in overlapping windows, and each window is decoded at all **four base64 alignments**. Decoding only the head let plain padding push the instruction past the cut; decoding at one alignment let a one-to-three character prefix shift every byte out of view.
- **False positives:** `atob` rejects malformed base64, and even a clean decode is reported only when an **injection rule matches**. Byte handling is deliberately lenient — a strict UTF-8 pass discarded the whole candidate when a few leading bytes were junk, which is exactly what a shifted blob looks like. Hashes, binaries, and image data produce nothing because they never match an injection phrase, and encoded JSON or an ordinary sentence is not flagged.

### Bounds

| Setting | Value | Reason |
| --- | --- | --- |
| Minimum candidate length | 24 chars | skips short tokens that merely look like base64 |
| Decode window | 4,096 chars | the unit decoded at a time |
| Window overlap | 256 chars | so an instruction straddling a boundary is still read |
| Decode character budget per payload | 65,536 chars | a budget in **characters, not attempts**. An attempt cap let harmless blobs starve the real one, and uncounted failed attempts made cost unbounded; failed decodes are charged too |

Once the budget is spent the remaining candidates in that payload are not inspected — a deliberate trade to bound cost up to the gateway's 1MB body limit.

## Latency impact (NFR-01)

Measured over 300 iterations on a 10KB payload against the p95 ≤ 50ms budget.

| Payload | p95 before | p95 after |
| --- | --- | --- |
| Benchmark default (10KB) | 0.13ms | **3.39ms** |
| Contains base64 blocks (10KB) | 0.16ms | 0.75ms |
| 1MB of mostly undecodable base64 (worst case) | n/a (no pass) | **23.1ms** |

The benchmark default is 10KB of a single repeated base64 character, so the whole payload is one enormous candidate — every window and alignment runs, which makes it the most expensive row here. It costs about 7% of the budget, and buys closure of the budget-starvation, zero-width, length-ceiling, alignment-shift, and base64url bypasses.

A payload with no base64 has no candidates and costs nothing.

## Known limits

These paths are **deliberately not handled**; the current behaviour is pinned by tests.

| Path | Current behaviour | Reason |
| --- | --- | --- |
| base64 split by spaces or narrow line wrapping | not detected | reassembling fragments risks treating ordinary English prose as a candidate, since prose is entirely base64 alphabet plus whitespace |
| double base64 encoding | not detected | recursive decoding invites a decode bomb and needs the cost budget redesigned |

Both need candidate reassembly with a fresh false-positive and cost trade-off, so they belong in their own issue.

The implementation lives in [`packages/gateway/src/detect.ts`](../packages/gateway/src/detect.ts); the attack samples are `T-07-b` (encoded attack) and `T-07-c` (benign base64 control) in [`attack-lab/scenarios/threats.json`](../attack-lab/scenarios/threats.json).
