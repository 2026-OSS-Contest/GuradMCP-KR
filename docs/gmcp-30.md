# GMCP-30 — 신규 환경 5분 기동 검증

[English](gmcp-30.en.md) | **한국어**

## 검증 조건

- 이전 GuardMCP-KR 이미지와 볼륨이 없는 신규 ARM64 또는 AMD64 환경
- 안정적인 인터넷 연결
- [Quick Start](quickstart.md) 외의 구두 도움 없음

## 기록표

### 1차 — 2026-07-31 (내부)

| 항목 | 기록 |
| --- | --- |
| 검증자 / 날짜 | 김규호 / 2026-07-31 (내부 1차) |
| OS / CPU 아키텍처 | macOS 15 (Darwin 25.5.0) / ARM64 (Apple Silicon) |
| Docker / Compose 버전 | Docker 29.4.2 |
| clone 시작 시각 | 미측정 — dev@8dc45bc 신규 git worktree + `npm ci`(성공)로 대체 |
| `docker compose --profile demo up -d --build` 시작 | T+0s (필수 서비스 중심) |
| 모든 필수 서비스 healthy | T+136s (console·gateway·control-plane·postgres·redis) |
| 콘솔 최초 접속 | T+142s (`/api/health` UP) |
| 총 소요 시간 | **142초 (< 5분 KPI 통과)** |
| 실패/우회 | 로컬 3000/5432 선점 → `CONSOLE_PORT` 등 env 오버라이드 |

### 2차 — 2026-08-11 (내부 재검증, demo 프로필 전체)

| 항목 | 기록 |
| --- | --- |
| 검증자 / 날짜 | 김규호 / 2026-08-11 (내부 2차, `dev`@`9f91841` 기준) |
| OS / CPU 아키텍처 | macOS (Darwin 25.5.0) / ARM64 |
| Docker 버전 | Docker 29.6.2 |
| 시작 시각 | 2026-08-11T09:57:05+09:00 (`docker compose --profile demo up -d --build`) |
| 포트 전략 | 호스트 기본 포트 충돌 회피: `POSTGRES_PORT=25432` `REDIS_PORT=26379` `CONSOLE_PORT=23000` `GATEWAY_PORT=23001` `CONTROL_PLANE_PORT=28080` `DEMO_AGENT_PORT=23002` `DEMO_MCP_TOOLS_PORT=23003` |
| 콘솔 `/api/health` UP | **T+18s** — `{"status":"UP","service":"console","dependencies":[{"url":"http://gateway:3001","up":true},{"url":"http://control-plane:8080","up":true}]}` |
| 필수 서비스 healthy | postgres·redis·gateway·control-plane·demo-mcp-tools healthy; console/demo-agent health starting 직후 UP |
| 게이트웨이 `/health` | UP (postgres·redis reachable) |
| Control Plane `/actuator/health` | UP |
| `/api/v1/overview` | 200 — `activePolicyPacks: ["default","korean-pii"]`, `pendingApprovals` 포함 (시드 동작) |
| 총 소요 시간 | **18초 (< 5분 KPI 통과)** — 이미지 캐시 warm 상태. 콜드 빌드는 1차 기록(~142s) 참고 |
| 문서 개선점 | 기본 호스트 포트(5432/6379/3000/8080) 선점이 빈번함. Quick Start에 **포트 오버라이드 예제 블록**을 더 눈에 띄게 둘 것(아래 반영). 외부 1인 재현은 [제출 재현 증빙](submission/reproduction-report.md)에서 추적 |

> 1·2차 모두 내부 검증(팀 로컬)입니다. DoD의 **외부 검증자 1인** 재현은 제출 패키징(GMCP-48) 단계에서 `docs/submission/reproduction-report.md`에 기록합니다.

## 합격 기준

1. 시작 후 5분 안에 콘솔이 로드된다. — **통과** (1차 142s, 2차 18s)
2. 모든 필수 서비스가 healthy이다. — **통과** (2차 demo 프로필)
3. 고정 시드 데모 API가 실행되고 정책 팩·승인 시드가 응답에 보인다. — **통과** (`overview` activePolicyPacks)
4. 검증자가 문서만으로 완료한다. — 내부 통과; 외부 1인은 GMCP-48에서 마감

## 포트 충돌 시 권장 커맨드

```bash
export POSTGRES_PORT=25432 REDIS_PORT=26379 \
  CONSOLE_PORT=23000 GATEWAY_PORT=23001 CONTROL_PLANE_PORT=28080 \
  DEMO_AGENT_PORT=23002 DEMO_MCP_TOOLS_PORT=23003
docker compose --profile demo up -d --build
# 콘솔: http://127.0.0.1:23000
```

완료된 기록은 재현 로그와 함께 Issue 또는 PR에 첨부하되 비밀값과 개인정보는 제거합니다.
