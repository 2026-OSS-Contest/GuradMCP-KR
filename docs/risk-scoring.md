# 위험 점수 산식

[English](risk-scoring.en.md) | **한국어**

검사 파이프라인 5단계(Risk Scorer)는 탐지 결과와 호출 맥락을 하나의 0–100 정수로 합칩니다. 이 점수는 정책 DSL의 `risk_score` 조건이 비교하는 값이며, 콘솔 Risk Gauge가 그리는 값과 같습니다. 구현은 [`packages/gateway/src/risk.ts`](../packages/gateway/src/risk.ts)에 있습니다.

## 1. 산식

```text
score = clamp(0, 100, 유형 기반 + 신뢰도 보정 + 유형 다양성 + 도구 위험도 + 서버 신뢰 + 대량 가중)
```

탐지가 하나도 없으면 나머지 항을 더하지 않고 **0점**입니다. 아무것도 발견되지 않은 호출이 도구나 서버 등급만으로 위험해지지 않도록 하기 위해서입니다.

| 항 | 값 | 근거 |
| --- | --- | --- |
| 유형 기반 | `INJECTION` 70 · `SECRET` 60 · `PII` 40 | 탐지된 유형 중 가장 높은 값 하나. 인젝션은 Agent 행동을 바꾸고, Secret은 권한을 넘기며, PII는 노출 피해가 큽니다. |
| 신뢰도 보정 | `(해당 유형의 최고 confidence − 0.8) × 20` | 탐지 규칙 카탈로그의 `confidence`를 0.8 기준으로 ±로 반영합니다. 기반값에 곱하지 않으므로 확신이 낮은 규칙 하나가 유형 대역 밖으로 떨어지지 않습니다. |
| 유형 다양성 | `(서로 다른 subtype 수 − 1) × 6`, 최대 12 | 서로 다른 신호가 겹칠수록 오탐일 가능성이 낮습니다. |
| 도구 위험도 | high 15 · medium 8 · low 0 | [`rules/tool-risk.json`](../packages/gateway/src/rules/tool-risk.json)의 분류. 전송·쓰기·삭제·실행은 high입니다. |
| 서버 신뢰 | `untrusted` 18 · `limited` 9 · `trusted` 0 | 같은 탐지라도 검증되지 않은 서버에서 온 것이 더 위험합니다. |
| 대량 가중 | PII 10건 이상 15 · 5건 이상 8 | FR-PII-05. 단일 응답의 대량 개인정보 반출(T-08)을 상향합니다. |

## 2. 판정 임계선

| 밴드 | 범위 | 의미 |
| --- | --- | --- |
| allow | 0–39 | 통과 |
| warn | 40–69 | 기록하고 통과 |
| approval | 70–89 | 사람 승인 대상 |
| block | 90–100 | 차단 대상 |

임계선은 `riskThresholds`로 내보내며 콘솔 Risk Gauge의 눈금과 같습니다. **점수 자체가 조치를 정하지는 않습니다.** 실제 action은 정책이 `risk_score.gte`와 다른 match 축을 함께 평가해 결정합니다. 예를 들어 부록 A.2의 `approve_external_email_with_secret`은 `risk_score.gte: 70`과 외부 수신 도메인 조건을 모두 만족할 때만 승인을 요구합니다.

## 3. 계산 예시

체크인된 규칙과 정책으로 실제 계산한 값입니다.

| 상황 | 계산 | 점수 | 밴드 |
| --- | --- | --- | --- |
| 오염된 tool description (T-04, untrusted 응답) | 70 + 2 + 12 + 0 + 18 | 100 | block |
| 외부 이메일에 Secret 포함 (부록 A.2) | 60 + 3 + 6 + 15 + 18 | 100 | block |
| 외부 이메일에 휴대전화번호 포함 | 40 + 3 + 6 + 15 + 18 | 82 | approval |
| 고객 조회 응답의 PII 1건 | 40 + 2 + 0 + 8 + 18 | 68 | warn |
| 고객 조회 응답의 PII 6건 | 40 + 2 + 0 + 8 + 18 + 8 | 76 | approval |
| 신뢰 서버의 동일 인젝션 | 70 + 2 + 0 + 8 + 0 | 80 | approval |

두 번째와 세 번째 행이 `risk_score.gte: 70` 정책의 의도된 동작입니다. 참고로 `send_email`의 수신자 주소 자체가 `PII.EMAIL`로 탐지되므로, 외부 전송 호출은 본문에 다른 개인정보가 없어도 warn 이상에서 시작합니다. 내부 도메인 수신자는 정책의 `to_not_domain` 조건에서 걸러집니다.

## 4. 튜닝과 기여

- **도구 위험도**는 코드 수정 없이 [`tool-risk.json`](../packages/gateway/src/rules/tool-risk.json)에 항목을 추가해 조정합니다. `match`는 `*` 와일드카드를 지원하고 먼저 일치한 항목이 이깁니다. 잘못된 항목은 게이트웨이 기동 시 오류로 중단됩니다.
- **탐지 신뢰도**는 [탐지 규칙 카탈로그](../packages/gateway/src/rules/)의 `confidence`로 조정합니다.
- 가중치를 바꾸면 정책 판정이 함께 바뀌므로 `npm run test:unit`과 `npm run bench`로 회귀를 확인하고, 의도된 변화는 PR 본문에 근거와 함께 적습니다.

## 5. 현재 한계

- 게이트웨이는 아직 서버별 신뢰 등급을 조회하지 않고 모든 호출을 `untrusted`로 평가합니다. 등급 모델은 GMCP-64에서 붙습니다.
- 점수는 규칙 기반이며 LLM 판별기를 사용하지 않습니다(NFR-01의 rule 파이프라인 지연 목표를 지키기 위해서입니다).
