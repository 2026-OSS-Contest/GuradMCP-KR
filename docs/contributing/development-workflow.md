# 개발 워크플로

[English](development-workflow.en.md) | **한국어**

이 문서는 애플리케이션 코드, 정책팩, 데이터셋과 문서를 변경할 때 공통으로 따르는 로컬 개발 및 Pull Request 절차입니다. 기여 원칙과 비코드 기여 예시는 [CONTRIBUTING.md](../../CONTRIBUTING.md#한국어)를 먼저 확인하세요.

## 1. 필수 도구

| 도구 | 최소 버전 | 사용 영역 |
| --- | ---: | --- |
| Node.js | 22 | TypeScript 앱, 패키지, 스크립트 |
| npm | 10.9.4 (`packageManager`) | workspace 의존성 및 명령 |
| JDK | 21 | Control Plane |
| Docker Engine | 24 | 통합 데모와 컨테이너 |
| Docker Compose | 2.20 | 로컬 서비스 구성 |

`npm install` 대신 lockfile을 그대로 재현하는 `npm ci`를 사용합니다. Java 작업은 시스템 Gradle이 아니라 저장소의 Gradle wrapper를 사용합니다.

## 2. 브랜치 모델

- `dev`: 일반 기여의 기준 및 PR 대상
- `main`: 검증된 릴리스 후보; maintainer가 관리
- 작업 브랜치: 최신 `dev`에서 분기

권장 브랜치 형식은 `<type>/<issue>-<description>`입니다. Issue가 없으면 번호를 생략할 수 있습니다.

```text
feature/GMCP-123-policy-preview
fix/GMCP-456-mask-phone
docs/contribution-guide
ci/license-report
```

Fork를 사용하는 경우 다음처럼 최신 upstream에서 작업 브랜치를 만듭니다.

```bash
git fetch upstream
git switch -c feature/GMCP-123-policy-preview upstream/dev
```

공유 브랜치의 이력을 임의로 다시 쓰거나 `main`/`dev`에 force-push하지 않습니다.

## 3. 설치와 빠른 확인

```bash
npm ci
npm run lint
npm run typecheck
npm run test:unit
```

전체 데모를 다루는 작업은 [Quick Start](../quickstart.md)에 따라 Compose 스택도 확인합니다.

## 4. 저장소 영역

| 경로 | 역할 | 주요 검증 |
| --- | --- | --- |
| `apps/console` | Next.js 콘솔 | lint, typecheck, Playwright |
| `apps/demo-agent`, `apps/demo-mcp-tools` | 데모 클라이언트와 MCP 도구 | lint, typecheck, unit test |
| `packages/gateway` | MCP 보안 게이트웨이 | unit/integration test |
| `packages/policy-engine` | 정책 파싱·평가 | unit test, policy validation |
| `services/control-plane` | Kotlin/Spring Control Plane | Gradle test |
| `policy-packs` | YAML 정책팩 | policy validation, benchmark |
| `attack-lab` | 공격·정상 데이터와 벤치마크 | benchmark |
| `docs` | 사용자·기여자 문서 | 링크, 한·영 동등성 |

## 5. 변경별 검증

가장 좁은 관련 테스트부터 실행한 뒤 아래 표의 필수 명령을 실행합니다. 전체 CI 계약과 정확한 required check 이름은 [CI 및 품질 게이트](../ci/quality-gates.md)에 있습니다.

| 변경 | 로컬 검증 |
| --- | --- |
| TypeScript/TSX | `npm run lint && npm run typecheck && npm run test:unit` |
| Kotlin/Java | `services/control-plane/gradlew -p services/control-plane test` |
| Console 사용자 흐름 | 위 TypeScript 검증 + `npm run test:e2e` |
| 정책팩·detector·benchmark 데이터 | `npm run policy:validate && npm run bench` |
| 생성 정책 변경 | `npm run policy:generate` 후 생성 diff 확인 |
| Compose·Dockerfile | `scripts/compose-verify.sh` 및 관련 이미지/프로필 실행 |
| 문서 | 상대 링크 확인, 예제 명령과 한·영 문서 동기화 |
| GitHub Actions | workflow 문법과 관련 로컬 명령 확인 |

저장소 전체 게이트는 `npm run check`로 실행할 수 있습니다. Docker와 브라우저가 필요한 검증은 별도 명령이므로 변경 범위에 따라 추가합니다.

## 6. 커밋과 Pull Request

1. [커밋 컨벤션](commit-convention.md)에 맞는 원자적 커밋을 만듭니다.
2. 원격 작업 브랜치에 push하고 base가 `dev`인 PR을 엽니다.
3. PR 템플릿에서 해당하지 않는 검증은 체크하지 말고 이유를 결과 요약에 적습니다.
4. 사용자 영향, 의도적 비호환, 실행한 명령과 결과, 관련 Issue를 기록합니다.
5. 사용자 개념이 바뀌면 한국어와 영어 문서를 같은 PR에서 함께 갱신합니다.
6. 모든 required check와 리뷰 대화를 해결한 뒤 maintainer의 병합을 기다립니다.

실제 개인정보, 운영 자격증명, 고객 로그, 외부 시스템을 공격할 수 있는 payload는 commit, Issue, PR 또는 CI artifact에 포함하지 않습니다. 취약점은 [SECURITY.md](../../SECURITY.md#한국어)의 비공개 절차로 제보합니다.
