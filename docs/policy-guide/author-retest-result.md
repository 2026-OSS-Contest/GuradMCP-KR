# Policy author retest result

## Observation record

| Item | Record |
| --- | --- |
| Start/end time | 2026-07-18T22:19:26+09:00 / 2026-07-18T22:20:56+09:00 (1 minute 30 seconds) |
| Guide and help | Read only the updated English `docs/policy-guide/README.en.md`. No implementation, validator source, existing policy, or existing author-test artifact was opened. No outside help was requested or received. |
| First validation result | **Failed**, exit code `1`. Policy schema validation reported `Validated 7 policies in 4 packs.`, but the command then reported that generated runtime policies were stale and requested a generator command that the authoring guide does not teach. |
| Final benchmark result | **Passed**, exit code `0`, overall `passed: true`. Recall `0.96875`, FPR `0`, precision `1`, p95 `0.1745779999999968` ms, average `0.15255053333333285` ms, payload `10240` bytes, block rate `1`, scenario pass rate `1`, fixture pass rate `1`, and fixture coverage rate `1`. It reported 14 author fixtures for 7 policies. |
| Distinct-participant limitation | This is not a valid “distinct participant” retest. The same agent previously completed the author-test exercise and therefore retained prior conceptual knowledge, even though no prior author-test artifact was consulted while authoring this pack. The benchmark output itself later enumerated all shipped fixtures, including earlier ones. |
| Documentation feedback | The initial validation workflow was incomplete because a valid new pack left generated runtime policies stale. The contributor UX was then fixed so `npm run policy:validate` validates and automatically generates the runtime bundle; the final retest confirms this gap is resolved. |
| Final retest result | **PASS** after the contributor-UX fix. Final validation and benchmark both exited zero; both new fixtures passed and all quality and coverage thresholds were satisfied. The distinct-participant limitation remains. |

## Authored artifacts

- Pack: `policy-packs/author-retest/`
- Policy: `author_retest_block_limited_fetch_obfuscated_injection`
- Match fixture: `attack-lab/policy-fixtures/author-retest/match.yaml`
- Not-match fixture: `attack-lab/policy-fixtures/author-retest/not_match.yaml`

The policy blocks a `fetch_url` response from a `limited` server when `INJECTION.OBFUSCATED` is present and the risk score is at least 90. The match fixture uses the exact lower boundary, 90. The not-match fixture keeps all other axes identical and uses 89, isolating the documented `gte` behavior. Both fixtures contain only synthetic text.

## Command evidence

### First validation

```text
$ npm run policy:validate

> guardmcp-kr@0.1.0 policy:validate
> tsx scripts/validate-policies.ts && tsx scripts/compile-runtime-policies.ts --check

Validated 7 policies in 4 packs.
Generated runtime policies are stale. Run: npx tsx scripts/compile-runtime-policies.ts
```

Exit code: `1`.

The suggested generator was not run because it is absent from the authoring guide and would modify an existing generated runtime artifact outside the requested new pack, fixtures, and result record.

### Final benchmark

```text
$ npm run bench
```

Relevant JSON evidence:

```json
{
  "metrics": {
    "recall": 0.96875,
    "fpr": 0,
    "precision": 1,
    "p95Ms": 0.16135900000000447,
    "averageMs": 0.14694587000000126,
    "payloadBytes": 10240,
    "blockRate": 1,
    "scenarioPassRate": 1,
    "fixturePassRate": 1,
    "fixtureCoverageRate": 1,
    "authorFixtures": 14,
    "policyCount": 7
  },
  "fixtures": [
    {
      "id": "author_retest_limited_fetch_injection_match",
      "coverage": {
        "policy_id": "author_retest_block_limited_fetch_obfuscated_injection",
        "expectation": "match"
      },
      "passed": true,
      "expected": {
        "action": "block",
        "matched_policy_ids": [
          "author_retest_block_limited_fetch_obfuscated_injection"
        ]
      },
      "actual": {
        "action": "block",
        "matched_policy_ids": [
          "author_retest_block_limited_fetch_obfuscated_injection"
        ]
      }
    },
    {
      "id": "author_retest_limited_fetch_injection_not_match",
      "coverage": {
        "policy_id": "author_retest_block_limited_fetch_obfuscated_injection",
        "expectation": "not_match"
      },
      "passed": true,
      "expected": {
        "action": "allow",
        "matched_policy_ids": []
      },
      "actual": {
        "action": "allow",
        "matched_policy_ids": []
      }
    }
  ],
  "passed": true
}
```

Exit code: `0`.

## Final contributor-UX retest

- Retest start/end: `2026-07-18T22:22:07+09:00` / `2026-07-18T22:22:15+09:00` (8 seconds).
- No implementation or validator source was inspected.

### Validation after the fix

```text
$ npm run policy:validate

> guardmcp-kr@0.1.0 policy:validate
> tsx scripts/validate-policies.ts && npm run policy:generate

Validated 7 policies in 4 packs.

> guardmcp-kr@0.1.0 policy:generate
> tsx scripts/compile-runtime-policies.ts

Wrote /home/ubuntu/GuradMCP-KR/packages/gateway/src/policies.generated.ts
```

Exit code: `0`. The documented contributor command now owns runtime-bundle generation and requires no separate manual recovery command.

### Benchmark after the fix

```text
$ npm run bench
```

- Exit code: `0`; overall `passed: true`.
- Recall `0.96875`; FPR `0`; precision `1`.
- p95 `0.1745779999999968` ms; average `0.15255053333333285` ms.
- Block rate `1`; scenario pass rate `1`.
- Fixture pass rate `1`; fixture coverage rate `1`.
- `author_retest_limited_fetch_injection_match`: `passed: true` with expected/actual `block` and the authored policy ID.
- `author_retest_limited_fetch_injection_not_match`: `passed: true` with expected/actual `allow` and no matched IDs.

Final verdict: **PASS**. This remains a same-agent verification rather than evidence from a distinct first-time participant.
