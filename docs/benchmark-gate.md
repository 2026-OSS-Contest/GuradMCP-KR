# 정책팩 PR 벤치마크 게이트

[English](benchmark-gate.en.md) | **한국어**

정책팩과 탐지 데이터는 실행 코드가 없어도 보안 판정을 바꿉니다. 따라서 `policy-packs/**`, `attack-lab/**`, 관련 detector/gateway 또는 gate 설정을 바꾸는 Pull Request는 `required / policy-benchmark` 체크에서 schema validation과 benchmark를 통과해야 합니다.

## 로컬 재현

```bash
npm ci
npm run policy:validate
npm run bench -- --output reports/benchmark.json
```

`npm run bench`는 동일한 명령에서 JSON report를 만들고 임계값 하나라도 벗어나면 non-zero로 종료합니다.

## 품질 기준 (12.2)

| 지표 | 합격 기준 | 의미 |
| --- | --- | --- |
| 한국형 PII Recall | `>= 0.90` | 라벨된 PII positive 중 탐지 비율 |
| 정상 샘플 FPR | `<= 0.05` | benign negative 중 잘못 탐지한 비율 |
| 공격 차단율 | `>= 0.80` | T-01~T-08 파생 시나리오 중 차단 비율 |
| 시나리오 기대값 일치율 | `= 1.00` | 공격/정상 각 ID의 실제 차단 여부가 `expectBlocked`와 일치 |
| rule pipeline p95 | `<= 50 ms` | 10KB payload, runner의 고정 반복 조건 |
| 기여 fixture 일치율 | `= 1.00` | 재귀 탐색한 YAML fixture의 action·매칭 정책 ID가 기대값과 모두 일치 |
| 정책 fixture 커버리지 | `= 1.00` | 배포 정책마다 match/not_match fixture를 각각 한 건 이상 보유 |
| Precision | report-only | 탐지로 분류한 샘플 중 실제 positive 비율 |
| 유형별 Recall | report-only | `type` 라벨이 붙은 positive 샘플의 유형별 탐지 비율 (`perTypeRecall`) |

`attack-lab/datasets/`의 각 positive 샘플은 기대 PII 유형을 `type` 필드로 라벨합니다. runner는 이를 모아 유형별 recall과 라벨된 유형 수(`labeledTypeCount`)를 report에 남기지만, 합격 판정은 위 절대 기준으로만 합니다.

현재 구현의 authoritative threshold는 [`attack-lab/benchmark/run.ts`](../attack-lab/benchmark/run.ts)의 `thresholds` 객체입니다. 문서와 코드가 다르면 PR에서 둘을 함께 고쳐야 하며, 기준을 통과시키기 위해 측정 샘플을 삭제해서는 안 됩니다.

## 정책팩 PR에서의 동작

1. 관련 변경 경로를 감지하면 `required / policy-benchmark` check 안에서 policy validation과 benchmark가 실행됩니다.
2. validation은 YAML parse, manifest/필수 필드, enum, `require_approval` block, 중복 ID와 `extends` 오류를 검사합니다.
3. benchmark는 현재 결과를 artifact/report로 남기고 위 절대 기준을 적용합니다. `scenarios`와 `fixtures` 배열에는 각 ID의 실제/기대 판정이 기록되고, `fixtureCoverage`는 정책별 positive/negative 보유 여부를 기록합니다. 중앙 validator가 10,240-byte payload, 공격 차단율, 시나리오 일치율, fixture 일치율과 커버리지를 독립적으로 다시 검사합니다.
4. 하나라도 실패하면 PR은 merge 불가입니다. `main` branch protection에서 `required / policy-benchmark`를 required로 지정합니다.
5. 문서만 바꾼 PR도 일반 lint/link check를 통과하지만 policy benchmark는 변경 경로 정책에 따라 생략할 수 있습니다. required check는 path skip 시에도 성공 상태를 반환하도록 workflow를 구성합니다.

## 실패를 고치는 순서

1. Actions summary 또는 `reports/benchmark.json`에서 실패 지표와 sample ID를 찾습니다.
2. 같은 commit에서 로컬 명령으로 재현합니다.
3. 정책 match를 좁히거나 detector/sample의 기대값을 고칩니다.
4. 공격 positive를 고칠 때는 유사한 benign negative를, FPR을 고칠 때는 의도한 positive를 함께 추가합니다.
5. 새 report와 의도된 verdict diff를 PR 본문에 붙입니다.

flaky timing으로 p95만 실패하면 동일 runner를 깨끗한 환경에서 한 번 재실행하고 두 결과를 남깁니다. 반복해서 기준을 넘으면 성능 회귀로 처리합니다.

## 의도적으로 판정을 바꿀 때

보안 기준 자체를 낮추는 변경은 일반 정책 PR과 분리합니다. 별도 Issue에서 위협 모델, 데이터셋 편향, 이전/새 report, 완화책을 리뷰하고 maintainer 승인을 받습니다. baseline/threshold 변경 커밋에는 `benchmark-change` 라벨과 한국어·영어 문서 갱신이 필요합니다. 임시 `continue-on-error`, sample 삭제 또는 check 우회는 허용하지 않습니다.

## 리뷰어 체크리스트

- [ ] 합성 공격 positive와 benign negative가 함께 있는가?
- [ ] report의 sample 수가 설명 없이 줄지 않았는가?
- [ ] expected verdict 변화가 정책 목적과 일치하는가?
- [ ] recall/FPR/block rate/p95 절대 기준, 시나리오 기대값과 정책 fixture 일치율/커버리지 100%를 모두 통과하는가?
- [ ] 새로운 regex가 ReDoS 또는 과도한 범위를 만들지 않는가?
- [ ] 한국어/영어 정책 설명이 같은 의미인가?
