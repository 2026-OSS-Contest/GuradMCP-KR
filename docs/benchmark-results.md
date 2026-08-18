# 벤치마크 결과 정리 (GMCP-35)

정책 벤치마크 게이트([`npm run bench`](benchmark-gate.md))가 산출하는 `reports/benchmark.json`을 개발계획서 KPI(품질 기준, [benchmark-gate.md `## 품질 기준 (12.2)`](benchmark-gate.md#품질-기준-122))에 대응시켜 정리한 결과 보고서입니다. 아래 수치는 실측값이며, 벤치마크 범위 밖의 KPI는 별도로 "측정 방법과 현재 상태"를 명시합니다.

## 실행 환경

| 항목 | 값 |
| --- | --- |
| 대상 브랜치 / 커밋 | `dev` @ `0cc84db80c99287a238c46a8a989c3fa6b79fb37` (2026-08-16 23:47:25 +0900) |
| 실행 시각 (`generatedAt`) | 2026-08-18T05:26:48.630Z |
| 실행 커맨드 | `npm run bench -- --output reports/benchmark.json` |
| Runner | [`attack-lab/benchmark/benchmark.ts`](../attack-lab/benchmark/benchmark.ts) |
| 게이트 결과 (`passed`) | **true** — 모든 절대 기준 통과 |

### 재현 커맨드

```bash
npm ci
npm run policy:validate
npm run bench -- --output reports/benchmark.json
```

`npm run bench`는 위 실행 환경과 동일한 커밋에서 재실행하면 동일한 판정(`passed: true`)을 재현합니다. 타이밍 지표(`p95Ms`, `averageMs`)는 하드웨어에 따라 값 자체는 달라질 수 있으나 기준(`<= 50ms`) 대비 여유가 커서 재현 환경 간 판정이 뒤집힐 가능성은 낮습니다.

## KPI 측정값 표 (전 항목)

`품질 기준 (12.2)` 표의 모든 지표를 실측값·목표·달성 여부로 정리합니다.

| 지표 | 목표 | 실측값 | 판정 | 목표 대비 |
| --- | --- | --- | --- | --- |
| 한국형 PII Recall | `>= 0.90` | **1.00** (37/37) | 게이트 통과 | 목표 대비 +10.0%p 초과 달성 |
| 정상 샘플 FPR | `<= 0.05` | **0.00** (0/26) | 게이트 통과 | 허용 오탐 예산의 0% 사용 (5.0%p 여유) |
| 공격 차단율 (blockRate) | `>= 0.80` | **1.00** (`expectBlocked: true` 시나리오 전건) | 게이트 통과 | 목표 대비 +20.0%p 초과 달성 |
| 시나리오 기대값 일치율 | `= 1.00` | **1.00** (40/40) | 게이트 통과 | 목표 정확히 충족 |
| rule pipeline p95 | `<= 50 ms` | **2.014 ms** (10KB payload) | 게이트 통과 | 예산의 약 4% 사용 (48.0ms 여유) |
| 기여 fixture 일치율 | `= 1.00` | **1.00** (29/29) | 게이트 통과 | 목표 정확히 충족 |
| 정책 fixture 커버리지 | `= 1.00` | **1.00** (10/10 정책) | 게이트 통과 | 목표 정확히 충족 |
| Precision | report-only | **1.00** (37/37) | 정보성 | 오탐 없음(위 FPR과 정합) |
| 유형별 Recall | report-only | **9개 유형 전부 1.00** | 정보성 | 아래 표 참고 |
| 형식 검증 효과 | report-only | FPR 15.4%p 감소 (샘플 4건) | 정보성 | 아래 표 참고 |

평균 지연(`averageMs`)은 1.701ms로 참고값이며 게이트 임계값은 없습니다.

## 정책·시나리오 결과 요약

| 항목 | 총계 | 통과 | 통과율 |
| --- | --- | --- | --- |
| 공격/정상 시나리오 (`scenarios`) | 40 | 40 | 100% |
| 기여자 정책 fixture (`author-test`, `author-retest`, `policy-regression`) | 29 | 29 | 100% |
| 커버리지 대상 배포 정책 | 10 | 10 (positive·negative 각 1건 이상) | 100% |
| PII 벤치마크 샘플 | 63 (positive 37 / negative 26) | — | recall 1.00 / FPR 0.00 |

커버리지가 확인된 10개 정책(일부): `author_retest_block_limited_fetch_obfuscated_injection`, `author_test_block_obfuscated_injection_fetch_response`, `block_env_file_read`, `block_untrusted_injection_response`, `warn_injection_request`, `approve_external_email_with_secret`, `mask_korean_pii_response`, `approve_external_email_with_korean_pii`.

## 탐지 계열별 지표 (게이트 강제)

PII 외에 세 계열이 각자 recall/FPR 쌍과 자기 임계값을 갖습니다. 하나로 합치지 않는 이유는 **강한 PII 점수가 다른 계열의 후퇴를 가리기 때문**입니다 — 계열이 분리돼 있어야 리포트가 어느 쪽이 무너졌는지 지목합니다.

| 계열 | 샘플 | Recall | FPR | 임계 | 근거 티켓 |
| --- | --- | --- | --- | --- | --- |
| 국내 서비스 자격증명 | 24 | **1.00** | **0.00** | 0.90 / 0.05 | GMCP-71 (FR-SEC-02) |
| 고엔트로피 안전망 | 20 | **1.00** | **0.00** | 0.90 / 0.05 | GMCP-72 (FR-SEC-03) |
| 한국어 프롬프트 인젝션 | 69 | **1.00** | **0.00** | 0.90 / 0.05 | GMCP-96 (FR-LAB-02) |

한국어 인젝션은 INJECTION subtype 7종을 전부 덮습니다. 이 계열의 음성 샘플은 **공격과 같은 어휘를 쓰는 실제 업무 문장**입니다(`개발자 모드`라고 쓰는 QA 문서, `알리지 않고`라고 쓰는 보안 정책). 무관한 텍스트로 채우면 FPR이 0으로 나오고 아무것도 측정하지 않기 때문입니다 — 자세한 원칙은 [정답 라벨 데이터셋](../attack-lab/datasets/README.md)에 있습니다.

## dry-run 관측 (`dryRunObservations`, GMCP-31)

리포트는 dry-run 정책 활동을 컨트롤 플레인에서 **조회하되 요구하지는 않습니다**. 게이트의 임계값은 전부 이 저장소의 데이터셋에서 나오므로, 컨트롤 플레인이 없어도 벤치마크는 돌아야 합니다.

**데이터가 없으면 0이 아니라 부재로 보고합니다.** 오늘 이 값은 `available: false`이고 사유는 "dry-run으로 도는 정책이 아직 없음(GMCP-77)"입니다. "아무 정책도 발동하지 않았음"과 "아무것도 관측되지 않았음"은 같은 JSON이지만 반대 주장이고, 심사용 보고서에서 그 둘을 섞으면 안 됩니다.

fire 건수를 FPR로 환산하지도 않습니다. `GET /policies/{id}/stats`는 분자(몇 번 발동했는지)만 주고, FPR에 필요한 분모(정상 트래픽이 얼마나 지나갔는지)를 주는 엔드포인트는 없습니다.

## 유형별 PII Recall (`perTypeRecall`, report-only)

| PII 유형 | 샘플 수 | 탐지 | Recall |
| --- | --- | --- | --- |
| ADDRESS | 7 | 7 | 1.00 |
| BANK_ACCOUNT | 3 | 3 | 1.00 |
| BIZ_NO | 2 | 2 | 1.00 |
| CARD | 5 | 5 | 1.00 |
| DL_NO | 2 | 2 | 1.00 |
| EMAIL | 5 | 5 | 1.00 |
| PASSPORT | 2 | 2 | 1.00 |
| PHONE | 7 | 7 | 1.00 |
| RRN_LIKE | 4 | 4 | 1.00 |

라벨된 유형 수(`labeledTypeCount`)는 9개로, positive 샘플 37건 전체가 유형 라벨을 보유합니다.

## 형식 검증 효과 (`validationImpact`, report-only)

| 필드 | 값 | 의미 |
| --- | --- | --- |
| `fprWithoutValidation` | 0.1538 (15.38%) | 형식 검증(체크섬 등)을 끄고 패턴 매칭만 적용했을 때의 FPR |
| `fprWithValidation` | 0.0000 (0%) | 실제 배포 구성의 FPR (`metrics.fpr`와 동일) |
| `falsePositivesPrevented` | 4건 | 형식 검증이 걸러낸 음성 샘플 수 |
| `fprReduction` | 0.1538 (15.38%p) | 형식 검증이 만든 FPR 개선폭 |

주민등록번호 체크섬·사업자등록번호 검증식·카드 Luhn·계좌 자릿수 검증이 26건의 음성 샘플 중 4건(형식은 일치하지만 체크섬이 틀린 번호 등)을 추가로 걸러내며, 이 값이 유지되려면 데이터셋에 해당 유형의 음성 샘플이 계속 존재해야 합니다.

## 목표 대비 달성률 분석

이번 실행에서는 게이트가 강제하는 7개 절대 기준을 **모두 통과**했으며, 미달 항목은 없습니다(`passed: true`). 다만 발표·보고 목적에서 짚어야 할 여유·리스크는 다음과 같습니다.

| 관찰 | 원인/배경 | 개선 계획 |
| --- | --- | --- |
| FPR·recall이 정확히 1.00 / 0.00으로 "완벽"함 | PII 벤치마크 데이터셋이 63건(음성 26건)으로 상대적으로 작아 여유 폭이 통계적으로 얇음 | 정책팩·PII 유형이 추가될 때마다 positive/negative 샘플을 비례해서 확충하고, 특히 형식은 맞지만 체크섬이 틀린 "회색지대" 음성 샘플을 유형별로 최소 1건 이상 유지 |
| p95 지연(2.014ms)이 목표(50ms)의 4%에 불과 | 단일 프로세스에서 순차 300회 반복 측정(동시성 없음)이라 실제 운영 트래픽의 동시 요청·GC 압력을 반영하지 못함 | 스테이징 환경에서 동시 요청 부하 하의 p95를 별도로 측정해 게이트 수치와 함께 보고서에 병기 |
| Precision, 유형별 Recall, 형식 검증 효과는 게이트 임계값이 없는 report-only 지표 | `attack-lab/benchmark/benchmark.ts`의 `thresholds` 객체에 해당 항목이 없음 (`docs/benchmark-gate.md` L28-30 참고) | 유형별 Recall과 형식 검증 효과(`fprReduction`)에 대한 최소 기준 도입을 별도 Issue로 검토 — 임계값 신설은 `benchmark-gate.md`의 "의도적으로 판정을 바꿀 때" 절차(별도 Issue, 위협 모델·데이터셋 편향 리뷰, `benchmark-change` 라벨)를 따라야 함 |
| GMCP-30 "5분 기동 KPI"는 이 벤치마크 범위 밖 | `benchmark.ts`는 탐지/정책 엔진 KPI만 측정하며, 신규 환경 기동 시간·healthy 여부는 수동 절차 | [`docs/gmcp-30.md`](gmcp-30.md) 기록표에 별도로 측정·기록 (본 문서에서는 다루지 않음) |

## 발표자료 인용용 요약

> **정책 벤치마크 게이트 (2026-08-18 측정)**
> - PII Recall **100%** (37/37, 목표 90%↑) · 정상 샘플 오탐률 **0%** (목표 5%↓)
> - 공격 차단율 **100%** (목표 80%↑) · 전체 40개 시나리오 기대값 일치율 **100%**
> - 한국어 프롬프트 인젝션 Recall **100%** / 오탐률 **0%** (69건, subtype 7종 전부)
> - 국내 서비스 자격증명 **100%/0%** (24건) · 고엔트로피 안전망 **100%/0%** (20건)
> - 정책 fixture 일치율 **100%** (29/29) · 커버리지 **100%** (10/10 정책)
> - 탐지 파이프라인 p95 지연 **2.01ms** / 10KB payload (목표 50ms 이하)
> - 형식 검증(체크섬 등)으로 오탐 **15.4%p** 추가 절감 (4건)
> - 게이트 판정: **통과** — 재현: `npm ci && npm run bench`
