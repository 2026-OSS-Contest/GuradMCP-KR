# korean-pii policy pack

## 한국어

`korean-pii`는 `default@^1.0.0`을 extends합니다. Tool 응답에서 `PII.*` 탐지 span을 마스킹하고, 외부 수신자에게 PII를 전송하려는 요청은 사람 승인 전까지 보류합니다. 기본 action은 `allow`, 평가 전략은 `severity-max`입니다.

지원 예시 tag: `PII.PHONE`, `PII.RRN_LIKE`, `PII.BANK_ACCOUNT`, `PII.BIZ_NO`, `PII.CARD`, `PII.ADDRESS`, `PII.EMAIL`, `PII.PASSPORT`, `PII.DL_NO`.

실제 운영 전 내부 도메인과 검사할 tool glob을 환경에 맞게 좁히고 합성 데이터로 FPR을 측정하세요.

## English

`korean-pii` extends `default@^1.0.0`. It masks detected `PII.*` spans in tool responses and pauses requests that would send PII to an external recipient. Its default action is `allow`; its evaluation strategy is `severity-max`.

Example tags include `PII.PHONE`, `PII.RRN_LIKE`, `PII.BANK_ACCOUNT`, `PII.BIZ_NO`, `PII.CARD`, `PII.ADDRESS`, `PII.EMAIL`, `PII.PASSPORT`, and `PII.DL_NO`.

Before production use, narrow internal domains and inspected tool globs for the deployment and measure FPR with synthetic data.
