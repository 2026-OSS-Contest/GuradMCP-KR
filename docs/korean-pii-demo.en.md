# Korean PII masking demo

**English** | [한국어](korean-pii-demo.md)

Looking up a support ticket returns a body carrying the customer's phone number, resident registration number, and bank account. The lookup itself is legitimate work, so blocking it would be wrong — the right answer is to **strip the personal data from the response and deliver the rest** (threats T-02 and T-08, `mask_then_allow`). This demo shows that difference by sending the same request twice.

## What gets compared

| | Unguarded | Guarded |
| --- | --- | --- |
| Call target | Tool server directly | Through the gateway |
| Verdict | none | `mask_then_allow` |
| Response body | `010-3456-7890`, `881124-2300149`, `계좌번호: 110-234-567890` | `[PHONE]`, `[RRN_LIKE]`, `[BANK_ACCOUNT]` |

**The agent code is identical on both sides.** Only the endpoint changes.

## Reproducing it

The demo profile must be running.

```bash
docker compose --profile demo up -d
```

```bash
./scripts/demo-korean-pii.sh
```

The script does not merely print a result — it **asserts** one. It checks that the unguarded response still carries all three values, that the guarded response carries none of them and shows tags instead, and that the verdict is `mask_then_allow`. Any mismatch exits non-zero.

To see it from the agent's point of view, call demo-agent.

```bash
curl --fail --silent --request POST http://localhost:3002/demo/consultation-log
```

`guarded.text` is the masked body, `vulnerable.text` is the unmasked one, and `maskedTypes` counts the masked spans per type. Add `?compare=false` for the guarded path alone.

## The data

The demo uses one consultation log, `TCK-2026-9001`. Every other seeded ticket carries **exactly one** personal-data type so per-type recall stays measurable; this ticket deliberately carries phone, RRN, and bank account in a single body, because the point is to show all three masking in one response.

Every value is synthetic. The RRN and account satisfy only the checksum shapes the detector validates and correspond to no real person or account, and the seed is generated deterministically by [`generate-tickets.ts`](../apps/demo-mcp-tools/scripts/generate-tickets.ts). Regenerate and commit if you change it.

```bash
npm run seed:tickets --workspace @guardmcp/demo-mcp-tools
```

## Why the "before" side needs a second run

The gateway does not keep the text as it was **before** masking. It stores only a digest reference (NFR-04, [`maskDiff.ts`](../packages/gateway/src/pipeline/maskDiff.ts)); retaining the original happens only when an operator turns it on explicitly through an environment variable.

So the "before" side is not fetched from the gateway — it comes from **running once more without the gateway in the path**. That looks like extra work, and it is the correct design: keeping originals around for comparison would mean a system built to prevent disclosure had created one more place to disclose from.

## Current limitation

Seeing the same comparison in the Detector Console (SCR-401) requires the control plane's `/detect/preview` to go through the real detector. Today that endpoint carries three regexes of its own — phone, e-mail, and sensitive paths — so it **detects neither the RRN nor the bank account**, and it renders masking as `010-****-5678` rather than `[PHONE]`. The control plane has no client to the gateway yet, so wiring this belongs to the Control Plane API work (GMCP-80). Until then the console's personal-data preview runs on mock data.
