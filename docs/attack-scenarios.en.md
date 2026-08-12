# Attack scenario catalog

**English** | [한국어](attack-scenarios.md)

What the Attack Lab reproduces is defined in [`attack-lab/scenarios/catalog.json`](../attack-lab/scenarios/catalog.json). The executable probes live in [`attack-lab/scenarios/threats.json`](../attack-lab/scenarios/threats.json), and this document indexes both. `npm run scenarios:validate` keeps the three from drifting apart.

## Threat catalog and OWASP mapping

| Threat | Name | OWASP LLM Top 10 |
| --- | --- | --- |
| T-01 | Indirect prompt injection | LLM01 |
| T-02 | Sensitive information disclosure | LLM02 |
| T-03 | Tool misuse | LLM06 |
| T-04 | Description poisoning | LLM01, LLM03 |
| T-05 | Rug pull | LLM03 |
| T-06 | Confused deputy | LLM06 |
| T-07 | Obfuscation | LLM01 |
| T-08 | Bulk disclosure | LLM02 |
| T-09 | System prompt leakage | LLM07 |

## Nineteen attack scenarios

| ID | Threat | Title | Expected verdict | Execution |
| --- | --- | --- | --- | --- |
| A-01 | T-01 | English "ignore instructions" hidden in an external README | block | probe |
| A-02 | T-01 | Korean "ignore instructions" wording | block | probe |
| A-03 | T-01 | Steering the Agent into reading a credential file | block | probe |
| A-04 | T-02 | LLM API key carried in a tool response | mask_then_allow | probe |
| A-05 | T-02 | VCS token carried in a tool response | mask_then_allow | probe |
| A-06 | T-03 | Role takeover followed by a destructive tool call | warn | probe |
| A-07 | T-03 | Read a credential file, then email it outside | require_approval | probe |
| A-08 | T-04 | Instructions planted in a tool description field | block | probe |
| A-09 | T-05 | Tool definition swapped after approval | require_approval | manual (GMCP-65) |
| A-10 | T-06 | Execution paired with a demand to hide it from the user | warn | probe |
| A-11 | T-06 | Untrusted instructions relayed through a trusted server | warn | manual (GMCP-64) |
| A-12 | T-07 | Instructions broken up with zero-width characters | block | probe |
| A-13 | T-07 | Base64-encoded instructions | block | probe |
| A-14 | T-08 | Bulk personal-data lookup in a single call | mask_then_allow | manual (GMCP-70) |
| A-15 | T-09 | Demand to reveal the system prompt | warn | probe |
| A-16 | T-02 | Cloud access key carried in a tool response | mask_then_allow | probe |
| A-17 | T-02 | Outbound webhook URL carried in a tool response | mask_then_allow | probe |
| A-18 | T-02 | Session token carried in a tool response | mask_then_allow | probe |
| A-19 | T-02 | Private key carried in a tool response | mask_then_allow | probe |

## Benign scenarios (false-positive measurement)

| ID | Title | Expected verdict |
| --- | --- | --- |
| N-01 | Legitimate base64 attachment data | allow |
| N-02 | Ordinary business text containing one person's data | mask_then_allow |
| N-03 | Ordinary business text that shares vocabulary with attacks | allow |
| N-04 | Ordinary identifiers that look like credentials | allow |

Benign scenarios carry the same weight as the block rate. A change that blocks an attack but breaks N-01 through N-04 has introduced a false positive.

## What a scenario contains

| Field | Meaning |
| --- | --- |
| `premise` | What must already be true for the attack to work |
| `vector` | The path the payload takes into the Agent's context |
| `expectedControl` | Where it should stop: pipeline stage, inspection context, expected detection tags, policy id, verdict |
| `pass` / `fail` | The success and failure criteria |
| `automation` | `probe` names probe ids in `threats.json`; `manual` states why and which ticket unblocks it |

`expectedControl.context` records direction, tool, and server trust because the same detection reaches a different policy depending on context. An injection detection only warns on a request through `warn_injection_request`, but blocks in an untrusted server's response through `block_untrusted_injection_response`.

## Why some scenarios stay manual

A-09, A-11, and A-14 cannot yet be reproduced with a single text probe. A-09's tool-definition snapshot/drift detection itself was implemented in GMCP-65 (`packages/gateway/src/tool-snapshot.ts`, `apps/demo-mcp-tools`'s `POST /tools/tamper` reproduction endpoint), but the scenario is an approve → tamper → re-list multi-step flow the runner's single-probe-vs-expected-result model can't express. A-11 and A-14 need per-server trust levels and bulk-disclosure risk escalation, arriving in GMCP-64 and GMCP-70 respectively. Rather than counting unimplemented capability as covered, those scenarios declare `automation.mode: "manual"` with the ticket that unblocks them. The block-rate KPI denominator is the **sixteen** probe-backed scenarios.

## Adding a scenario

1. Add a probe to `attack-lab/scenarios/threats.json`. Use synthetic values only — never real credentials or personal data.
2. Add the scenario to `attack-lab/scenarios/catalog.json` and claim the probe through `automation.probes`. An unclaimed probe fails validation.
3. Add the same id to the tables in this document and the [Korean document](attack-scenarios.md).
4. Run the checks.

```bash
npm run scenarios:validate && npm run bench
```

Validation covers more than the schema: it checks that `expectedControl.detections` still matches what the detector produces.

## Running them

The [Attack Scenario Runner](attack-lab-runner.en.md) executes the expected control point each scenario claims.

```bash
npm run attacklab
```

A scenario whose `expectedControl.policy` is `null` is reported as a `GAP`: no policy owns it, so the target verdict does not appear. That does not fail CI, but it is listed on every run. If a detector change stops emitting an expected tag, this is where it fails.
