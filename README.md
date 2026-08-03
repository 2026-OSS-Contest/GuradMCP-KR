# GuardMCP-KR

[English](README.en.md) | **한국어**

> Every tool call, inspected.

GuardMCP-KR은 AI Agent와 MCP 서버 사이에서 요청과 응답을 검사하는 한국어 개인정보 보호형 오픈소스 보안 게이트웨이입니다. YAML 정책, 한국형 PII·Secret·프롬프트 인젝션 탐지 결과와 위험 점수를 함께 평가해 `allow`, `warn`, `mask_then_allow`, `require_approval`, `block` 중 하나를 결정합니다.

> [!IMPORTANT]
> 이 저장소는 초기 데모 단계입니다. Gateway는 체크인된 `default`/`korean-pii` 정책팩을 실제로 평가하지만, 사람 승인 UI·Replay·영구 감사 저장은 아직 구현되지 않았습니다. `require_approval`은 데모에서 fail-closed로 거부됩니다. 실제 개인정보나 운영 자격증명에는 사용하지 마세요.

## 5분 Quick Start

필수 도구: Docker Engine 24+와 Compose v2.20+. 로컬 포트 `3000`–`3003`, `8080`, `5432`, `6379`를 사용할 수 있어야 합니다.

```bash
git clone https://github.com/2026-OSS-Contest/GuradMCP-KR.git
cd GuradMCP-KR
docker compose --profile demo up -d --build
docker compose ps
```

모든 서비스가 `healthy`가 되면 <http://localhost:3000>을 엽니다. 데모 프로파일은 고정 시드 데이터, Demo Agent와 데모 MCP Tools를 함께 시작합니다. 종료는 다음 한 줄입니다.

```bash
docker compose --profile demo down -v
```

상세한 5분 검증 절차, 정상 상태, 문제 해결은 [Quick Start](docs/quickstart.md)를 참고하세요. 제품 서비스만 시작하려면 `docker compose up -d`, 개발 모드 데모를 함께 시작하려면 `docker compose --profile dev up -d`를 사용합니다.

## 동작 방식

```text
AI Agent → GuardMCP-KR Gateway → MCP Tools
                │
                ├─ 양방향 탐지와 정책 평가
                ├─ Control Plane (데모 inventory/health)
                └─ PostgreSQL + Redis (health와 고정 seed)
```

- **양방향 검사:** 요청의 위험한 도구·인자와 응답의 PII·Secret·간접 인젝션을 모두 검사합니다.
- **설명 가능한 판정:** MCP 응답 metadata에 정책 ID, 탐지 유형, 위험 점수와 마스킹 결과를 반환합니다. 영구 감사 저장은 후속 범위입니다.
- **한국형 기본값:** 휴대전화번호, 주민등록번호 유사 패턴, 사업자등록번호, 계좌번호 등 한국형 PII를 다룹니다.
- **코드 없는 확장:** 정책과 탐지/공격 샘플은 YAML 또는 데이터셋만으로 기여할 수 있습니다.

## 정책 작성

정책 DSL v1의 모든 `match` 축, 다섯 action, 평가 규칙, 승인 블록과 정책팩 구조는 [정책 작성 가이드](docs/policy-guide/README.md)에 있습니다. 바로 실행 가능한 예제는 [`policy-packs/default`](policy-packs/default)와 [`policy-packs/korean-pii`](policy-packs/korean-pii)를 참고하세요.

정책팩 PR은 다음 품질 게이트를 통과해야 합니다.

```bash
npm run policy:validate
npm run bench
```

게이트가 측정하는 항목과 회귀 기준은 [정책팩 벤치마크 게이트](docs/benchmark-gate.md)에 설명되어 있습니다.

## 기여하기

코드 기여가 아니어도 환영합니다.

- 정책 규칙 한 건 추가
- 한국형 PII 패턴과 양성/음성 샘플 추가
- 공격 또는 정상 샘플 데이터셋 추가
- 문서·번역·접근성 개선

준비 방법과 작은 작업 예시는 [CONTRIBUTING.md](CONTRIBUTING.md)와 [good first issue 설계](docs/contributing/good-first-issues.md)를 참고하세요. 모든 참여자는 [행동 강령](CODE_OF_CONDUCT.md)을 따라야 합니다.

## 보안

보안 취약점은 공개 Issue에 올리지 마세요. GitHub의 비공개 보안 권고 기능을 이용하는 절차와 대체 비공개 채널은 [SECURITY.md](SECURITY.md)에 있습니다.

## 문서

| 문서 | 한국어 | English |
| --- | --- | --- |
| Quick Start | [열기](docs/quickstart.md) | [Open](docs/quickstart.en.md) |
| 정책 작성 가이드 | [열기](docs/policy-guide/README.md) | [Open](docs/policy-guide/README.en.md) |
| 위험 점수 산식 | [열기](docs/risk-scoring.md) | [Open](docs/risk-scoring.en.md) |
| 벤치마크 게이트 | [열기](docs/benchmark-gate.md) | [Open](docs/benchmark-gate.en.md) |
| 벤치마크 결과 정리 | [열기](docs/benchmark-results.md) | [Open](docs/benchmark-results.md) |
| 기여 가이드 | [열기](CONTRIBUTING.md#한국어) | [Open](CONTRIBUTING.md#english) |
| 개발 워크플로 | [열기](docs/contributing/development-workflow.md) | [Open](docs/contributing/development-workflow.en.md) |
| 커밋 컨벤션 | [열기](docs/contributing/commit-convention.md) | [Open](docs/contributing/commit-convention.en.md) |
| CI·품질 게이트 | [열기](docs/ci/quality-gates.md) | [Open](docs/ci/quality-gates.md) |
| 공통 에이전트 지침 | [열기](AGENTS.md) | [Open](AGENTS.md) |
| 보안 정책 | [열기](SECURITY.md#한국어) | [Open](SECURITY.md#english) |

## 라이선스

[Apache License 2.0](LICENSE). Copyright 2026 The GuardMCP-KR Contributors.
