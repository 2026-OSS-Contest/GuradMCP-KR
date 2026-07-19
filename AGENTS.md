# AGENTS.md

GuardMCP-KR에서 AI 코딩 에이전트(Claude Code, Codex, Copilot 등)와 새 기여자가 작업할 때 따르는 저장소 규칙입니다. 사람이 읽어도 그대로 유효한 온보딩 문서입니다.

## 프로젝트 한 줄 요약

AI Agent와 MCP 서버 사이에서 요청·응답을 양방향 검사해 한국형 PII·Secret·프롬프트 인젝션을 탐지하고, YAML 정책으로 `allow / warn / mask_then_allow / require_approval / block`을 판정하는 보안 게이트웨이입니다. 배경과 사용법은 [README.md](README.md), 문서는 [docs/](docs/quickstart.md)를 참고하세요.

## 에이전트 기본 동작

- 사용자 답변·PR·이슈 본문은 한국어로 작성한다. 코드 식별자·기술 용어는 원문을 유지한다.
- 기존 코드 스타일을 우선한다. 변경 범위를 최소화하고, 요청받지 않은 리팩터링은 하지 않는다.
- 주 개발 환경은 macOS Apple Silicon, CI는 Linux(ubuntu)다. 안내하는 명령은 두 환경 모두에서 동작해야 한다.
- 커밋 메시지·PR·이슈에 AI 서명이나 attribution을 넣지 않는다. (예: "Generated with …" 배지, 봇 Co-Authored-By 트레일러)

## 모듈 구조 — 하나의 레포, 모듈별 분리

| 경로 | 모듈 | 스택 |
| --- | --- | --- |
| `packages/gateway` | MCP 프록시 + 탐지기 (Data Plane) | TypeScript, Node.js 22 |
| `packages/policy-engine` | 정책 DSL v1 평가 엔진 | TypeScript |
| `services/control-plane` | 정책·승인·리플레이 API (Control Plane, BE) | Kotlin, Spring Boot, JDK 21 |
| `apps/console` | 보안 콘솔 (FE) | Next.js |
| `apps/demo-agent` · `apps/demo-mcp-tools` | 시연용 Agent와 MCP 도구 서버 | TypeScript |
| `policy-packs/` | YAML 정책팩 (`default`, `korean-pii`, …) | YAML |
| `attack-lab/` | 공격 시나리오·데이터셋·벤치마크·회귀 fixture | JSON/YAML |
| `scripts/` · `infra/` | 정책 검증기·코드젠·Compose 헬퍼·CI 게이트 | TS/Bash |

## Git 규칙 — Contribute Rule (2026-07-06 ver.)

1. 깃헙 레포는 하나의 레포 내부에 모듈별(be/fe/…)로 분리한다.
2. 브랜치는 `dev` 브랜치를 기본으로 하며, 추후 `stage` 브랜치를 통해 테스트를 진행한다.
   - `dev` 브랜치가 생성되기 전까지는 `main`을 base로 사용한다.
3. 작업 진행 시 기능별로 브랜치를 생성하며, 브랜치 네이밍은 `feature/${Plane 티켓 ID}`로 한다.
   - 예: MCP Gateway PoC 구현 → `feature/GMCP-9` 브랜치 생성 후 작업
4. 커밋 메시지는 Conventional Commits(`feat:` `fix:` `docs:` `build:` `chore:` …)를 따른다.
5. 하나의 커밋은 하나의 목적만 가진다(Atomic Commit). 서로 다른 목적의 변경은 논리 단위로 커밋을 분리해 리뷰와 롤백이 쉬운 단위를 유지한다.
6. PR은 [PR 템플릿](.github/PULL_REQUEST_TEMPLATE.md)을 채우고, required check(CI · policy benchmark · licenses)를 모두 통과해야 병합한다. 연결된 GitHub 이슈가 있으면 `Closes #번호`, Plane 티켓은 본문에 ID를 표기한다.

### 확정 대기 항목 (팀 합의 후 갱신)

- 커밋 메시지 요약 언어 — 현재 히스토리는 영어, 한국어 허용 여부 미정
- `dev`/`stage` 브랜치 생성 시점과 머지 전략(제안: feature→dev는 merge commit, dev→main은 squash)

## 자주 쓰는 명령

```bash
npm ci                    # 의존성 설치 (Node.js 22+)
npm run check             # 전체 로컬 게이트: lint + typecheck + unit + policy:validate + bench

# 개별 실행
npm run lint
npm run typecheck
npm run test:unit         # Vitest
npm run test:e2e          # Playwright (apps/console)
npm run policy:validate   # 정책 YAML 스키마 검증 + 런타임 번들 재생성
npm run bench             # 탐지 recall/FPR/p95/차단율 벤치마크

# Control Plane (Kotlin)
services/control-plane/gradlew -p services/control-plane test

# 전체 스택 기동/종료 (Docker Engine 24+, Compose v2.20+)
scripts/compose-up.sh demo
scripts/compose-down.sh --volumes
```

## 주석·로그 규칙

- 주석은 코드가 보여줄 수 없는 제약이나 의도만 핵심 위주로 적고, 자명한 코드에는 달지 않는다.
- 주석 언어는 해당 파일의 기존 스타일을 따른다. 현재 코드베이스(TS·YAML·Kotlin)는 영어 주석이 기본이다.
- 서버 로그는 영어 + 구조화 JSON으로 작성하고 이모지·한국어를 넣지 않는다.
  - 예: `{"level":"info","service":"gateway","port":3001,"message":"listening"}`
- 로그·이벤트에 민감정보 원문을 남기지 않는다. 마스킹본만 기록한다.

## Control Plane(BE) 계층 규칙 — `services/control-plane`

- `controller → service → repository` 단방향 흐름을 유지한다. Controller에서 Repository 직접 호출 금지.
- DTO와 Entity를 분리하고, Entity를 API 응답에 그대로 노출하지 않는다.
- `@Transactional`은 서비스 계층에 둔다.
- 공통 응답 형식·전역 예외 처리·인증은 도메인 밖 공통 계층에서 관리한다.
- 상세 패키지 구조와 공통 응답 객체 규격은 BE 담당(김규호·오현택) 확정 후 이 문서에 추가한다.

## 에이전트가 꼭 지킬 것

1. **생성 파일 직접 수정 금지.** `packages/gateway/src/policies.generated.ts`는 `npm run policy:generate`가 만드는 산출물이다. 정책은 `policy-packs/**`의 YAML을 고친 뒤 재생성 결과를 같은 커밋에 포함한다. CI가 stale 여부를 검사한다.
2. **정책 변경에는 fixture 한 쌍.** 정책팩을 추가·수정하면 `attack-lab/policy-fixtures/`에 `match`/`not_match` fixture를 함께 추가하고 `npm run policy:validate && npm run bench`를 통과시킨다.
3. **실데이터 금지.** 실제 개인정보·유효한 토큰·고객 데이터를 코드·fixture·문서·커밋 메시지 어디에도 넣지 않는다. 항상 합성 데이터만 사용한다.
4. **품질 기준 완화 금지.** 벤치마크가 실패한다고 `scripts/ci/quality-gates.json`이나 임계값을 같은 PR에서 낮추지 않는다. 의도된 변화라면 PR 본문에 수치 diff와 근거를 적는다.
5. **문서는 한/영 병행.** 사용자 개념이 바뀌면 한국어 문서와 영어 문서(`*.md` / `*.en.md`)를 함께 갱신한다.
6. **취약점은 비공개로.** 보안 문제는 공개 Issue 대신 [SECURITY.md](SECURITY.md) 절차를 따른다.

## 환경 기준

- Node.js >= 22 (npm workspaces), JDK 21 (저장소 Gradle wrapper 사용)
- Docker Engine 24+, Docker Compose v2.20+
- 로컬 포트 3000–3003, 8080, 5432, 6379 사용
