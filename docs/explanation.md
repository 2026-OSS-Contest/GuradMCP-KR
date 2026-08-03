# 판정 설명 문구 (Explanation)

[English](explanation.en.md) | **한국어**

게이트웨이가 방출하는 모든 Guard 이벤트는 사람이 읽을 수 있는 판정 근거를 함께 담습니다. 정책의 `message`는 작성자가 선택적으로 적는 산문이라 없을 수도 있으므로, 읽는 사람이 실제로 필요한 근거(판정·결정 정책·심각도·증거)는 게이트웨이가 조립합니다.

## 형태

```json
{
  "reasonCode": "BLOCK_ENV_FILE_READ",
  "ko": "차단했습니다 — 정책 block_env_file_read (심각도 critical). 탐지 SECRET.LLM_API_KEY 1건, 위험 점수 96.",
  "en": "Blocked — policy block_env_file_read (severity critical). Detected SECRET.LLM_API_KEY ×1, risk score 96."
}
```

| 필드 | 의미 |
| --- | --- |
| `reasonCode` | 로케일과 무관한 기계 판독용 키 |
| `ko` | 한국어 문장 (콘솔 기본 로케일) |
| `en` | 같은 판정의 영어 문장 |

한국어와 영어를 **함께** 실어 보내므로, 콘솔은 로케일에 맞는 문장을 추가 조회 없이 고를 수 있습니다.

## 문구 규칙 (기획서 10.6)

1. **판정은 사실 서술로 씁니다.** `차단했습니다 — 정책 block_env_file_read (심각도 critical)` 형식을 모든 판정에 고정합니다.
2. **과장하지 않습니다.** 느낌표, 공포 소구, 위험을 부풀리는 수식어를 쓰지 않습니다.
3. **기술 식별자는 번역하지 않습니다.** 정책 ID와 탐지 태그(`SECRET`, `PII.PHONE`)는 원문 그대로 둡니다.

## 증거 표기

증거는 **탐지 태그별 건수와 위험 점수**만 적습니다. 태그는 subtype까지 유지합니다 — `PII.RRN_LIKE`와 `PII.PHONE`은 대응 긴급도가 달라 `PII`로 뭉치면 읽는 사람이 판단할 근거가 사라집니다. 탐지된 원문은 어떤 로케일에도 담기지 않습니다(NFR-04). 매칭된 정책이 없으면 그 사실을 그대로 씁니다 — `매칭된 정책 없음, 정책팩 기본 동작`.

## 판정별 문구

| verdict | 한국어 | English |
| --- | --- | --- |
| `block` | 차단했습니다 | Blocked |
| `require_approval` | 승인을 기다립니다 | Waiting for approval |
| `mask_then_allow` | 마스킹 후 전달했습니다 | Masked, then forwarded |
| `warn` | 경고를 기록하고 통과시켰습니다 | Warned and forwarded |
| `allow` | 통과시켰습니다 | Allowed |

문구는 **라우터가 실제로 도달한 판정**을 서술합니다. 승인이 타임아웃되어 차단으로 끝나면 `차단했습니다 (승인 시간이 초과되어)`처럼 원인까지 적습니다 — 같은 `block`이라도 정책이 요구한 차단과 아무도 응답하지 않아 생긴 차단은 다른 사실이기 때문입니다.

## 결정 정책 표기

매칭된 정책이 둘 이상이면 문장은 **판정을 결정한 정책**을 지목합니다. `matchedPolicyIds`는 priority 오름차순 전체 목록이라 첫 원소가 `severity-max`에서 채택된 정책이 아닌 경우가 많고, `severity`·`reasonCode`·`message`는 모두 결정 정책에서 오므로 첫 원소를 지목하면 같은 이벤트 안에서 모순이 생깁니다. 나머지 매칭은 `외 N건 매칭`으로만 셉니다.

## 전달 범위 (현재 한계)

설명은 **게이트웨이가 방출하는 이벤트**에 실립니다. Control Plane의 `GuardEvent`(Replay 타임라인 DTO)와 `audit_events` 테이블, OpenAPI 스키마에는 아직 이 필드가 없습니다. 게이트웨이 이벤트를 Control Plane으로 넘기는 감사 로깅 파이프라인 자체가 GMCP-24에서 구축 중이므로, 필드 전달은 그 작업에서 함께 다루는 것이 맞습니다.

구현은 [`packages/gateway/src/pipeline/explanation.ts`](../packages/gateway/src/pipeline/explanation.ts)에 있습니다.
