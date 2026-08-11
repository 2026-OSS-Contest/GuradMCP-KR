# GuardMCP-KR 결과보고서 (최종본 초안)

2026 OSS 공모전 · 작성: GuardMCP-KR 팀 (GMCP-47) · 골격: [중간 결과보고서](../reports/interim-report.md) (GMCP-32) · 벤치마크 수치: [벤치마크 결과 정리](../benchmark-results.md) (GMCP-35)

> **상태:** 제출 직전 수치·스크린샷·시연 영상 링크를 채우는 최종 초안입니다. 마감 전 팀 리뷰 1회 반영 후 PDF/제출 패키지로 고정합니다.

## 1. 개요

GuardMCP-KR은 AI Agent와 MCP 서버 사이에 위치하는 **한국어 개인정보 보호형 오픈소스 보안 게이트웨이**입니다. tool 호출의 요청·응답을 양방향으로 검사하고, YAML 정책·탐지 결과·위험 점수를 종합해 `allow` / `warn` / `mask_then_allow` / `require_approval` / `block` 중 하나를 판정합니다.

- 저장소: <https://github.com/2026-OSS-Contest/GuradMCP-KR>
- 기준 브랜치: `dev` (2026-08-11 기준 약 250+ 커밋, 다수의 feature PR 병합 완료)
- 5분 기동: [GMCP-30](../gmcp-30.md) — 내부 재검증 18–142초 KPI 통과

## 2. 문제 정의

1. **MCP 검사 계층 부재** — 프로토콜 자체에 요청·응답 보안 계층이 없다.
2. **한국형 PII** — 휴대전화·RRN 유사·사업자·계좌 등이 범용 DLP 기본 규칙에 약하다.
3. **간접 프롬프트 인젝션** — tool 응답에 심긴 지시문이 Agent 행동을 오염시킨다.
4. **설명 불가능한 차단** — 근거 없는 차단은 운영·튜닝이 불가능하다.

## 3. 솔루션 요약

| 영역 | 구현 | 상태 (2026-08-11) |
| --- | --- | --- |
| MCP Gateway | `packages/gateway` | 완료 — 양방향 검사, 표준 블록 오류, 신뢰 등급, path 정규화 |
| Policy Engine | `packages/policy-engine` + `policy-packs/**` | 완료 — severity-max/first-match, path normalize, dry-run |
| 탐지기 | PII / Secret / Injection + 고엔트로피 안전망 | 완료 — 한국형 서비스 자격증명 테이블(GMCP-71), 엔트로피 망(GMCP-72) |
| 응답 SECRET 마스킹 | `mask_secret_response` | 완료 (GMCP-113) |
| Control Plane | Kotlin/Spring | 완료(v1) — overview·replay·audit·approvals·SSE |
| Console | Next.js | 진행 — policy builder 등 다수 화면 반영; settings/detector PR 일부 잔여 |
| Attack Lab | 카탈로그 + decision-engine 러너 | 완료 — `npm run attacklab` / scenarios:validate |
| 5분 기동 | compose demo 프로필 | 내부 검증 통과; 외부 1인 재현은 제출 전 |

## 4. 아키텍처

중간 보고서의 배치 다이어그램(User → Agent → Gateway → Tools / Control Plane ↔ Console)을 유지합니다. 신뢰 경계는 Agent·MCP Tools 쪽을 untrusted로 두고, Gateway가 유일한 검사 지점입니다.

주요 데이터 흐름:

1. Agent가 Gateway `/mcp`로 tool call
2. Gateway가 detect → risk → decide → route (mask/block/approval/upstream)
3. 판정 이벤트가 Control Plane에 적재·SSE로 Console에 전달
4. require_approval 시 Redis 대기열 + 타임아웃 fail-closed (CP 연동 시 hold)

## 5. 벤치마크·품질 수치

`npm run bench` 게이트 기준 (상세: [benchmark-results.md](../benchmark-results.md)):

| 지표 | 목표 | 실측(대표) | 판정 |
| --- | --- | --- | --- |
| 한국형 PII Recall | ≥ 0.90 | 1.00 | 통과 |
| 정상 FPR | ≤ 0.05 | 0.00 | 통과 |
| 공격 차단율 | ≥ 0.80 | 1.00 | 통과 |
| rule pipeline p95 | ≤ 50ms | ≪ 1ms | 통과 |
| 정책 fixture 커버리지 | 1.00 | 1.00 | 통과 |

재현:

```bash
npm ci
npm run policy:validate
npm run bench -- --output reports/benchmark.json
```

## 6. 시연 시나리오 (요약)

1. **T-01 악성 README / .env** — 차단 + Replay에서 근거 확인
2. **한국형 PII 마스킹** — 상담 로그 응답 `mask_then_allow`
3. **외부 이메일 + Secret** — require_approval / approve_masked (데모 스크립트 경로)
4. **Attack Lab 러너** — 카탈로그 시나리오를 decision engine으로 일괄 채점

## 7. 남은 작업·한계 (정직 고지)

- 감사 이벤트 SHA-256 해시 체인(GMCP-83)·원문 저장 정책(GMCP-84) 일부 Should 항목
- Console settings/detector 화면 PR 충돌 해소 후 머지 잔여
- 외부 1인 Quick Start 재현 증빙 (GMCP-48)
- 기능 동결(W7, 2026-08-20) 이후 feat 금지 — [feature-freeze.md](../feature-freeze.md)

## 8. 결론

GuardMCP-KR은 MCP 트래픽에 한국어 특화 검사·설명 가능 판정·오픈소스 재현 경로를 제공하는 공용 보안 게이트웨이로, 벤치 KPI와 5분 기동 목표를 내부 검증 기준으로 충족했습니다. 제출 전 외부 재현·기능 동결·최종 패키징만 남은 상태입니다.
