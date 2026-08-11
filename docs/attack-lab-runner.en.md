# Attack Scenario Runner

**English** | [한국어](attack-lab-runner.md)

The [attack scenario catalog](attack-scenarios.en.md) records an **expected control point** for each scenario: this detection, under this direction and server trust, reaches this policy and ends in this verdict. The runner executes that claim and checks it (FR-LAB-01).

```bash
npm run attacklab
```

## How this differs from the benchmark

| | `npm run bench` | `npm run attacklab` |
| --- | --- | --- |
| Question asked | Did the detector see anything | **What verdict did policy reach** |
| Pipeline | ③ detection | ③ detection → ⑤ risk score → ⑥ policy decision |
| Result unit | Aggregate numbers (recall, block rate) | **A verdict per named scenario** |

When the benchmark's block rate drops you still have to find which rule broke. The runner says `A-13 FAIL expected block, got warn`.

The runner calls `detect`, `scoreRisk`, and `decide` **directly**. They are the shipped modules, not a copy, so a pass is a statement about the pipeline that ships. The gateway's HTTP surface is deliberately not involved: a scenario has to reproduce in CI with nothing running.

## Grades

| Grade | Meaning | CI |
| --- | --- | --- |
| `PASS` | The pipeline reached the control point the catalog claims | pass |
| `FAIL` | A claimed control point did not hold | **fail** |
| `GAP` | The catalog names no policy (`policy: null`) and the target verdict did not appear | pass (reported) |
| `SKIP` | `automation.mode: "manual"` — not reproducible with a probe yet | pass (reported) |
| `RUN` | Vulnerable mode — nothing to grade | — |

`GAP` is not counted as a failure because a CI light that is red for something never built stops being trusted. Counting it as a pass would be worse: it would claim protection that does not exist. It is **neither**, so it gets its own grade and is listed on every run.

## Current gaps — no response-direction secret masking

Six scenarios sit at `GAP`: `A-04`, `A-05`, and `A-16` through `A-19`. They share one cause.

The response-direction policies today cover **only INJECTION (block) and PII (mask)**. Nothing masks `SECRET` in a response, so a GitHub token, AWS key, private key, or Toss secret key arriving in a tool response is delivered to the Agent under `allow`. It is detected — there is simply no verdict for it.

The runner found this on its first execution; it is tracked as GMCP-113. Once the policy lands, those six move from `GAP` to `PASS`.

## Vulnerable mode

```bash
npm run attacklab -- --mode vulnerable
```

This inspects **nothing**. It does not dress a verdict up as `allow`; it does not run detection at all — the point is what reaches the Agent when no gateway is in the path, and imitating that with an `allow` from a real evaluation would be a different claim.

Vulnerable runs are not graded. The number to read is how much got through.

## Selecting scenarios

```bash
# By scenario id
npm run attacklab -- --only A-13
# By threat id (every scenario derived from it)
npm run attacklab -- --only T-01,T-07
```

## The report

Written to `reports/attacklab.json`. Each scenario carries a **step event** per probe, shaped like the §8.4 GuardEvent.

| Field | Content |
| --- | --- |
| `argsDigest` | Digest of the inspected text. **The text itself is never included** (NFR-04) |
| `verdict`, `riskScore`, `matchedPolicyIds`, `decidingPolicyId` | The verdict and its basis |
| `explanation` | Korean and English reason for the verdict |

`explanation` is on every step so Replay never has to reconstruct a reason (M3 DoD).

## The other entry points

FR-LAB-01 names three entry points. `npm run attacklab` is one; the other two are not wired to this runner yet.

| Entry point | Status |
| --- | --- |
| `npm run attacklab` | implemented |
| `guardmcp` CLI | GMCP-97 (not implemented) |
| `POST /attacklab/run/{scenarioId}` | accepts the request only; execution is unwired, and it currently knows `T-01`–`T-08` ids rather than the catalog's `A-01`–`A-19` |

Both should call `runCatalog()` rather than reimplementing the loop.
