# default policy pack

## 한국어

`default`는 다른 정책팩이 확장할 수 있는 기본 안전선입니다. `severity-max`로 모든 매칭 정책을 합성하며, 매칭이 없으면 `allow`입니다.

| 정책 | 목적 |
| --- | --- |
| `block_env_file_read` | `.env`, SSH private key, credentials 파일 요청 차단 |
| `block_untrusted_injection_response` | 저신뢰 응답의 높은 위험 인젝션 차단 |
| `approve_external_email_with_secret` | 외부 이메일과 Secret/PII가 함께 있으면 승인 대기 |

운영 환경에서는 자체 allowlist와 server trust를 추가하고, 먼저 dry-run/warn으로 오탐을 측정하세요.

## English

`default` is the base safety boundary extended by other packs. It composes all matching policies with `severity-max` and uses `allow` when nothing matches.

| Policy | Purpose |
| --- | --- |
| `block_env_file_read` | block requests for `.env`, SSH private keys, and credential files |
| `block_untrusted_injection_response` | block high-risk injection in low-trust responses |
| `approve_external_email_with_secret` | pause external email containing a secret or PII for approval |

Add deployment-specific allowlists and server trust. Measure false positives in dry-run or warn mode before enforcement.
