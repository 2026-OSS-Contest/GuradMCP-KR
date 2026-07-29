# 판정 설명 문구 (Explanation)

[English](explanation.en.md) | **한국어**

모든 Guard 이벤트는 사람이 읽을 수 있는 판정 근거를 함께 담습니다. 정책의 `message`는 작성자가 선택적으로 적는 산문이라 없을 수도 있으므로, 읽는 사람이 실제로 필요한 근거(판정·결정 정책·심각도·증거)는 게이트웨이가 조립합니다.

## 형태

```json
{
  "reasonCode": "BLOCK_ENV_FILE_READ",
  "ko": "차단했습니다 — 정책 block_env_file_read (심각도 critical). 탐지 SECRET 1건, 위험 점수 96.",
  "en": "Blocked — policy block_env_file_read (severity critical). Detected SECRET ×1, risk score 96."
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

증거는 **유형별 건수와 위험 점수**만 적습니다. 탐지된 원문은 어떤 로케일에도 담기지 않습니다(NFR-04). 매칭된 정책이 없으면 그 사실을 그대로 씁니다 — `매칭된 정책 없음, 정책팩 기본 동작`.

## 판정별 문구

| verdict | 한국어 | English |
| --- | --- | --- |
| `block` | 차단했습니다 | Blocked |
| `require_approval` | 승인을 기다립니다 | Waiting for approval |
| `mask_then_allow` | 마스킹 후 전달했습니다 | Masked, then forwarded |
| `warn` | 경고를 기록하고 통과시켰습니다 | Warned and forwarded |
| `allow` | 통과시켰습니다 | Allowed |

문구는 **라우터가 실제로 도달한 판정**을 서술합니다. 승인이 타임아웃되어 차단으로 끝나면 이벤트에는 `차단했습니다`가 기록됩니다 — 정책이 제안한 판정이 아니라 실제로 일어난 일을 적기 위해서입니다.

구현은 [`packages/gateway/src/pipeline/explanation.ts`](../packages/gateway/src/pipeline/explanation.ts)에 있습니다.
