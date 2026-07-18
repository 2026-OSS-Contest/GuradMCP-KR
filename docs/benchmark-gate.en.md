# Policy-pack pull-request benchmark gate

**English** | [한국어](benchmark-gate.md)

Policies and detection data change security verdicts even when they contain no application code. A pull request that changes `policy-packs/**`, `attack-lab/**`, a related detector/gateway, or gate configuration must therefore pass schema validation and the benchmark in the `required / policy-benchmark` check.

## Reproduce locally

```bash
npm ci
npm run policy:validate
npm run bench -- --output reports/benchmark.json
```

`npm run bench` writes a JSON report and exits non-zero when any threshold fails.

## Quality thresholds (section 12.2)

| Metric | Passing threshold | Meaning |
| --- | --- | --- |
| Korean PII recall | `>= 0.90` | detected fraction of labeled PII positives |
| Benign-sample FPR | `<= 0.05` | incorrectly detected fraction of benign negatives |
| Attack block rate | `>= 0.80` | blocked fraction of scenarios derived from T-01–T-08 |
| Scenario expectation pass rate | `= 1.00` | each attack/benign ID agrees with `expectBlocked` |
| Rule-pipeline p95 | `<= 50 ms` | 10KB payload under the runner's fixed repetition setup |
| Contribution fixture pass rate | `= 1.00` | every recursively discovered YAML fixture matches its expected action and policy IDs |
| Policy-fixture coverage | `= 1.00` | every shipped policy has at least one match and one not-match fixture |
| Precision | report-only | actual positives among detected samples |

The authoritative thresholds are the `thresholds` object in [`attack-lab/benchmark/run.ts`](../attack-lab/benchmark/run.ts). Update code and documentation together if they differ. Never remove measured samples merely to pass a threshold.

## What happens on a policy-pack pull request

1. A relevant path change runs policy validation and the benchmark inside `required / policy-benchmark`.
2. Validation checks YAML parsing, manifests/required fields, enums, `require_approval` blocks, duplicate IDs, and `extends` errors.
3. The benchmark records current output as an artifact/report and enforces the absolute thresholds above. `scenarios` and `fixtures` record actual and expected verdicts per ID, while `fixtureCoverage` records positive/negative coverage per policy. The central validator independently rechecks the 10,240-byte payload, block rate, scenario expectations, fixture pass rate, and coverage.
4. Any failure blocks merge. Configure `required / policy-benchmark` as required in `main` branch protection.
5. Documentation-only changes still pass normal lint/link checks and may skip the expensive benchmark by path policy. A required workflow must still return a success state when its path-specific work is skipped.

## Fixing a failure

1. Find the failing metric and sample ID in the Actions summary or `reports/benchmark.json`.
2. Reproduce it locally at the same commit.
3. Narrow the policy match or correct the detector/sample expectation.
4. When fixing an attack positive, add a similar benign negative; when fixing FPR, preserve an intended positive.
5. Attach the new report and intended verdict diff to the pull request.

If only p95 fails because of timing noise, rerun the same runner once in a clean environment and retain both results. Treat repeated excess as a performance regression.

## Intentional verdict or threshold changes

Separate a change that weakens a security threshold from an ordinary policy pull request. Review the threat model, dataset bias, old/new reports, and mitigation in a dedicated issue, then obtain maintainer approval. A baseline/threshold commit requires the `benchmark-change` label and updates to both Korean and English documentation. Temporary `continue-on-error`, sample deletion, or check bypass is not acceptable.

## Reviewer checklist

- [ ] Does every synthetic attack positive have a useful benign negative?
- [ ] Did the sample count avoid unexplained decreases?
- [ ] Do expected verdict changes match policy intent?
- [ ] Do recall, FPR, block rate, p95, scenario expectations, and 100% fixture pass/coverage rates all pass?
- [ ] Does a new regex avoid ReDoS and excessive scope?
- [ ] Do Korean and English policy explanations mean the same thing?
