# 5분 Quick Start

[English](quickstart.en.md) | **한국어**

이 절차의 성공 기준은 신규 환경에서 5분 안에 콘솔을 열고, 고정 시드 데모를 실행할 수 있는 상태가 되는 것입니다.

## 0:00–1:00 — 준비와 복제

- Docker Engine 24 이상
- Docker Compose v2.20 이상 (`docker compose version`)
- Git
- 사용 가능한 로컬 포트: `3000`–`3003`, `8080`, `5432`, `6379`

```bash
git clone https://github.com/2026-OSS-Contest/GuradMCP-KR.git
cd GuradMCP-KR
```

## 1:00–4:00 — 데모 시작

```bash
docker compose --profile demo up -d --build
```

`demo` 프로파일은 제품 서비스인 `gateway`, `control-plane`, `console`, `postgres`, `redis`에 더해 `demo-agent`, `demo-mcp-tools`와 고정 시드 데이터를 시작합니다. 호스트 아키텍처가 ARM64 또는 AMD64여도 같은 명령을 사용합니다.

## 4:00–5:00 — 상태 확인과 콘솔 접속

```bash
docker compose ps
curl --fail --silent http://localhost:3001/health
curl --fail --silent http://localhost:8080/actuator/health
# 검사 파이프라인 계측: 판정 카운트와 지연 백분위만 (페이로드·탐지 값 미포함)
curl --fail --silent http://localhost:3001/metrics
```

`docker compose ps`에서 시작된 서비스가 `healthy`이고 health 요청이 성공하면 <http://localhost:3000>을 엽니다. 다음 고정 시나리오 호출로 정책 ID·탐지 항목·위험 점수가 포함된 판정을 확인합니다.

```bash
curl --fail --silent --request POST http://localhost:3002/demo/pii
```

Demo Agent(LangChain4j)는 T-01 악성 README 시나리오도 재현합니다. 두 모드는 **동일한 에이전트 로직으로 실행되고 대상 엔드포인트만 다릅니다.** 보호 모드는 게이트웨이(`/mcp`)를 경유해 정책으로 `.env` 읽기를 차단하고, 미적용 모드는 같은 도구 서버를 직접(`/tools/call/…`) 호출해 검사 없이 유출이 성립하는 과정을 보여줍니다. 도구 서버는 격리된 샌드박스이므로 `.env`는 합성 값이고 `send_email`은 실제 SMTP 대신 로컬 outbox에만 기록합니다.

```bash
curl --fail --silent --request POST "http://localhost:3002/demo/readme-summary?mode=guarded"
curl --fail --silent --request POST "http://localhost:3002/demo/readme-summary?mode=vulnerable"
```

차단 여부를 눈으로 읽는 대신 검증까지 하려면 다음을 실행합니다. 자세한 내용은 [.env 유출 공격 데모](env-leak-demo.md)에 있습니다.

```bash
./scripts/demo-env-leak.sh
```

상담 로그 조회에서 휴대전화·주민등록번호·계좌번호가 마스킹되는 T-02/T-08 시나리오도 같은 방식으로 실행합니다. 이쪽은 조회 자체가 정당하므로 차단이 아니라 `mask_then_allow`로 끝납니다. 자세한 내용은 [한국어 개인정보 마스킹 데모](korean-pii-demo.md)를 참고하세요.

```bash
curl --fail --silent --request POST http://localhost:3002/demo/consultation-log
# 마스킹 결과를 검증까지 하려면
./scripts/demo-korean-pii.sh
```

## 프로파일

| 목적 | 명령 | 포함 범위 |
| --- | --- | --- |
| 제품 최소 구성 | `docker compose up -d` | gateway, control-plane, console, PostgreSQL, Redis |
| 재현 가능한 데모 | `docker compose --profile demo up -d` | 제품 구성 + demo-agent + demo-mcp-tools + 고정 시드 |
| 개발 모드 데모 | `docker compose --profile dev up -d` | 제품 구성 + demo-mcp-tools(소스 변경 반영) + demo-agent(빌드 이미지) |

개발 모드에서는 `demo-mcp-tools`가 소스 변경을 반영합니다. `demo-agent`는 컴파일형 JVM 서비스라 빌드된 이미지로 실행되며, 소스 변경은 이미지 재빌드로 반영합니다.

## MCP Agent 연결

Agent가 사용하던 MCP endpoint를 게이트웨이 endpoint로 교체합니다. 로컬 데모의 기본 endpoint는 `http://localhost:3001/mcp`입니다. 정책팩은 `default`와 `korean-pii`가 활성화됩니다.

이 데모는 정책 평가·요청/응답 마스킹·차단 경로를 검증합니다. 사람 승인 UI와 영구 audit/replay는 아직 없으므로 `require_approval` 판정은 upstream을 실행하지 않고 fail-closed 오류를 반환합니다. PostgreSQL/Redis는 기동·seed·health 경계를 검증하지만 현재 판정 이력을 저장하지 않습니다.

## 종료와 초기화

```bash
docker compose --profile demo down
# 데이터 볼륨까지 지워 같은 고정 시드로 다시 시작
docker compose --profile demo down -v
```

## 문제 해결

1. **컨테이너가 healthy가 아님:** `docker compose ps`와 `docker compose logs <service>`를 확인합니다.
2. **포트 충돌:** 위 포트를 점유한 프로세스를 종료하거나 compose의 host port를 변경합니다.
3. **이미지 빌드 실패:** `docker compose build --pull --no-cache <service>`로 기반 이미지를 새로 받습니다.
4. **콘솔에 이벤트가 없음:** `gateway`와 `control-plane`의 health를 확인하고 Demo를 다시 실행합니다.

5분 KPI 검증 기록 양식은 [GMCP-30 검증 체크리스트](gmcp-30.md)에 있습니다.
