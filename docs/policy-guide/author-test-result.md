# External policy-author test result

## Observation record

| Item | Record |
| --- | --- |
| Start/end time | 2026-07-18T21:33:36+09:00 / 2026-07-18T21:35:22+09:00 (1 minute 46 seconds) |
| Help requested outside the guide | None requested or received. Only `docs/policy-guide/author-test.en.md` and `docs/policy-guide/README.en.md` were read. |
| Misunderstood field or rule | None observed. “High-severity” was interpreted as the exact `high` severity enum, and “risk is at least 80” as `risk_score.gte: 80`. |
| First validation result | Passed on the first run with exit code 0: `Validated 6 policies in 3 packs.` |
| Final benchmark result | Retest passed with exit code 0. Recall `0.96875`, FPR `0`, precision `1`, p95 `0.11194900000000985` ms, average `0.07381805333333347` ms, attack block rate `0.8`, fixture pass rate `1`, and `2` author fixtures. Both authored fixture IDs were enumerated with `passed: true`. |
| Documentation improvement | The initial guide omitted regression-fixture serialization/discovery and the benchmark did not enumerate fixtures. The updated regression-fixture contract and per-fixture benchmark report fully address this gap. |

## Authored policy

Pack: `policy-packs/author-test/`

The policy blocks with `severity: high` only when all documented axes match:

- direction is `response`;
- originating tool is exactly `fetch_url`;
- server trust is `untrusted`;
- normalized detections contain `INJECTION.OBFUSCATED`;
- normalized risk score is at least 80.

No real secrets or personal data are present in the policy message or fixtures.

## Synthetic regression fixtures

Fixtures: `attack-lab/datasets/author-test/attack.yaml` and `attack-lab/datasets/author-test/benign.yaml`.

### Attack fixture: expected match

The attack event uses `response`, `fetch_url`, `untrusted`, the exact `INJECTION.OBFUSCATED` tag, and risk score 85. Every policy axis therefore matches, so the expected action is `block` and the expected matched ID is `author_test_block_obfuscated_injection_fetch_response`.

### Benign fixture: expected non-match

The benign event remains an untrusted `fetch_url` response but has no detections and risk score 20. It fails both the required detection condition and `gte: 80`, so the policy must not match. The pack's `default_action: allow` is therefore expected.

On the initial run, the guide did not define the fixture serialization or benchmark discovery contract and the aggregate-only output could not prove fixture discovery. The updated guide now defines recursive YAML discovery and the fixture schema, while the updated benchmark directly confirms both fixtures.

## Documentation-fix retest

- Retest start/end: `2026-07-18T21:38:24+09:00` / `2026-07-18T21:38:39+09:00` (15 seconds).
- Command: `npm run bench`.
- Exit code: `0`.
- `metrics.fixturePassRate`: `1` (required threshold `1`).
- `metrics.authorFixtures`: `2`, equal to the two authored files.
- `author_test_obfuscated_injection_attack`: `passed: true`; expected and actual action are `block`, with exactly `author_test_block_obfuscated_injection_fetch_response` matched.
- `author_test_benign_fetch_response`: `passed: true`; expected and actual action are `allow`, with no matched policy IDs.
- Overall benchmark `passed`: `true`.
- Final author-test result: **PASS**. The documentation gap identified in the initial run is resolved, both fixture outcomes are directly verified, and all benchmark thresholds remain satisfied.

## Command evidence

### First validation

Command taught by the guide:

```text
npm run policy:validate
```

Output:

```text
> guardmcp-kr@0.1.0 policy:validate
> tsx scripts/validate-policies.ts

Validated 6 policies in 3 packs.
```

Exit code: `0`.

### Final benchmark

Command taught by the guide:

```text
npm run bench
```

Output:

```json
{
  "generatedAt": "2026-07-18T12:34:24.787Z",
  "metrics": {
    "recall": 0.96875,
    "fpr": 0,
    "precision": 1,
    "p95Ms": 0.09725899999999399,
    "averageMs": 0.07004151999999979,
    "blockRate": 0.8,
    "samples": 53,
    "positives": 32,
    "negatives": 21,
    "threats": 10
  },
  "thresholds": {
    "recall": 0.9,
    "fpr": 0.05,
    "p95Ms": 50,
    "blockRate": 0.8
  },
  "passed": true
}
```

Exit code: `0`.

All reported benchmark thresholds were preserved.
