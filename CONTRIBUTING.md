# GuardMCP-KR 기여 가이드 / Contributing to GuardMCP-KR

## 한국어

[English](#english)

GuardMCP-KR은 코드뿐 아니라 정책, 데이터셋, 문서 기여를 동등하게 환영합니다. 처음 기여한다면 범위가 작고 검증 방법이 분명한 [`good first issue`](docs/contributing/good-first-issues.md)를 선택하세요.

### 행동 원칙

- [행동 강령](CODE_OF_CONDUCT.md)을 따릅니다.
- 실제 개인정보, 유효한 토큰, 고객 데이터는 Issue·PR·fixture에 넣지 않습니다.
- 취약점은 공개 Issue 대신 [비공개 보안 채널](SECURITY.md)을 사용합니다.
- 작은 PR 하나에는 하나의 목적만 담습니다.

### 기여 흐름

기본 개발 브랜치는 `dev`입니다. 일반 기능, 버그 수정, 문서 변경은 `dev`에서 분기하고 Pull Request의 base도 `dev`로 지정합니다. `main`은 검증된 릴리스 후보를 위한 브랜치이므로 maintainer가 요청한 릴리스·긴급 수정 외에는 직접 대상으로 삼지 않습니다.

```bash
git clone https://github.com/<your-account>/GuradMCP-KR.git
cd GuradMCP-KR
git remote add upstream https://github.com/2026-OSS-Contest/GuradMCP-KR.git
git fetch upstream
git switch -c feature/GMCP-123-short-description upstream/dev
npm ci
```

1. 큰 동작 변경은 구현 전에 Issue에서 문제와 완료 조건을 합의합니다. 보안 취약점은 공개 Issue를 사용하지 않습니다.
2. `dev` 최신 상태에서 작업 종류와 Issue를 드러내는 브랜치를 만듭니다: `feature/GMCP-123-policy-preview`, `fix/GMCP-456-mask-phone`, `docs/contribution-guide`.
3. 한 브랜치와 PR에는 한 목적만 담고, 생성 파일은 원본 변경과 함께 갱신합니다.
4. 커밋 메시지는 [Angular 커밋 규칙 기반 컨벤션](docs/contributing/commit-convention.md)을 따릅니다.
5. 변경 범위에 맞는 로컬 검증을 실행하고 `dev` 대상 PR에 결과를 기록합니다.

설치, 저장소 구조, 변경 유형별 검증 명령과 PR 흐름은 [개발 워크플로](docs/contributing/development-workflow.md)에 정리되어 있습니다.

### 코드 없이 기여하는 세 가지 길

#### 1. 정책 규칙 한 건

1. [정책 작성 가이드](docs/policy-guide/README.md)를 읽습니다.
2. `policy-packs/<pack>/policies/`의 가장 가까운 정책 YAML을 복사합니다.
3. 고유한 `id`, 좁은 `match`, 의도한 `action`과 테스트 fixture를 추가합니다.
4. `npm run policy:validate`와 `npm run bench`를 실행합니다.

#### 2. 한국형 PII 패턴

양성 샘플과 헷갈리기 쉬운 음성 샘플을 함께 제출합니다. 모든 값은 실제 사람이 아닌 합성 데이터여야 합니다. 형식 검증(체크섬/Luhn/자릿수 등), 기대 탐지 태그와 마스킹 결과를 설명하세요.

#### 3. 공격 또는 정상 샘플

`attack-lab/datasets/`에 최소 한 개 공격 샘플과 회귀를 막을 정상 샘플을 추가합니다. 출처, 위협 ID(T-01~T-08), 기대 verdict, 난독화가 있다면 해제 과정을 기록하세요. 악성 payload는 프로젝트 테스트 목적에서만 사용합니다.

### 개발 환경

필수 도구는 Node.js 22+, npm 10.9.4, JDK 21, Docker Engine 24+, Docker Compose v2.20+입니다.

```bash
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run policy:validate
npm run bench
```

Kotlin/Java 영역을 변경했다면 저장소의 Gradle wrapper로 테스트합니다.

```bash
services/control-plane/gradlew -p services/control-plane test
```

콘솔 사용자 흐름을 변경했다면 Playwright도 실행합니다.

```bash
npm run test:e2e
```

### 정책팩 PR 품질 게이트

`policy-packs/**` 또는 벤치마크 데이터셋을 바꾸는 PR은 스키마 검증과 벤치마크를 필수 체크로 통과해야 합니다. 탐지 recall, 정상 샘플 FPR 또는 p95 지연이 기준보다 나빠지면 실패합니다. 기준, 재현 명령, 의도적 변경 절차는 [벤치마크 게이트 문서](docs/benchmark-gate.md)에 있습니다. 결과가 의도된 변화라도 실패를 숨기거나 기준을 같은 PR에서 임의로 낮추지 마세요.

### Pull Request 체크리스트

- base 브랜치를 `dev`로 지정합니다(maintainer가 요청한 릴리스·긴급 수정 제외).
- PR 제목을 `<type>: <subject>` 또는 `<type>(<scope>): <subject>` 형식으로 작성합니다.
- 관련 Issue와 사용자 영향을 적습니다.
- 테스트 또는 데이터셋으로 변경 행위를 증명합니다.
- 한국어/영어 문서 중 변경된 개념을 양쪽에 반영합니다.
- 생성 파일, 비밀값, 실제 개인정보가 없는지 확인합니다.
- 정책 변경이면 `policy:validate`와 benchmark 결과 요약을 붙입니다.
- 리뷰 피드백은 새 커밋으로 반영하고 대화를 해결 표시하기 전에 근거를 남깁니다.

### good first issue 만들기

한 이슈는 30–90분 안에 완료 가능한 한 단위여야 합니다. 정확한 파일, 허용/금지 범위, fixture, 실행할 명령과 합격 기준을 포함하고 `good first issue`와 해당 영역 라벨을 붙입니다. 바로 등록할 수 있는 다섯 설계는 [good first issue 카탈로그](docs/contributing/good-first-issues.md)에 있습니다.

---

## English

[한국어](#한국어)

GuardMCP-KR values policy, dataset, and documentation contributions as much as application code. If this is your first contribution, choose a bounded, verifiable [`good first issue`](docs/contributing/good-first-issues.en.md).

### Ground rules

- Follow the [Code of Conduct](CODE_OF_CONDUCT.md#english).
- Never put real personal data, valid tokens, or customer data in issues, pull requests, or fixtures.
- Use the [private security channel](SECURITY.md#english), not a public issue, for vulnerabilities.
- Keep one purpose per pull request.

### Contribution workflow

The default development branch is `dev`. Branch normal features, bug fixes, and documentation changes from `dev`, and target `dev` in the pull request. `main` is reserved for validated release candidates; target it only for a maintainer-directed release or hotfix.

```bash
git clone https://github.com/<your-account>/GuradMCP-KR.git
cd GuradMCP-KR
git remote add upstream https://github.com/2026-OSS-Contest/GuradMCP-KR.git
git fetch upstream
git switch -c feature/GMCP-123-short-description upstream/dev
npm ci
```

1. For substantial behavior changes, agree on the problem and completion criteria in an issue before implementation. Never use a public issue for a vulnerability.
2. Create a branch from the latest `dev` whose name identifies the change and issue: `feature/GMCP-123-policy-preview`, `fix/GMCP-456-mask-phone`, or `docs/contribution-guide`.
3. Keep one purpose per branch and pull request, and update generated files with their source change.
4. Follow the [Angular-style commit convention](docs/contributing/commit-convention.en.md).
5. Run validation appropriate to the change and record the results in a pull request targeting `dev`.

See the [development workflow](docs/contributing/development-workflow.en.md) for setup, repository layout, change-specific validation commands, and the pull-request lifecycle.

### Three no-code contribution paths

#### 1. One policy rule

1. Read the [Policy Authoring Guide](docs/policy-guide/README.en.md).
2. Copy the closest policy YAML under `policy-packs/<pack>/policies/`.
3. Add a unique `id`, a narrow `match`, the intended `action`, and a test fixture.
4. Run `npm run policy:validate` and `npm run bench`.

#### 2. A Korean PII pattern

Submit positive samples and easily confused negative samples together. Every value must be synthetic and must not identify a real person. Document format validation such as a checksum, Luhn, or length rule, the expected detection tag, and masking result.

#### 3. An attack or benign sample

Add at least one attack sample and a benign regression sample under `attack-lab/datasets/`. Record its source, T-01–T-08 threat ID, expected verdict, and de-obfuscation steps. Use malicious payloads only for project testing.

### Development environment

Prerequisites are Node.js 22+, npm 10.9.4, JDK 21, Docker Engine 24+, and Docker Compose v2.20+.

```bash
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run policy:validate
npm run bench
```

Run the repository Gradle wrapper after changing Kotlin or Java code:

```bash
services/control-plane/gradlew -p services/control-plane test
```

Run Playwright after changing console user flows:

```bash
npm run test:e2e
```

### Policy-pack pull-request gate

A pull request that changes `policy-packs/**` or benchmark datasets must pass schema validation and the benchmark required checks. The gate fails on regressions in detection recall, benign-sample FPR, or p95 latency. See the [benchmark gate](docs/benchmark-gate.en.md) for thresholds, reproduction commands, and the intentional-change process. Never hide a failure or casually lower a baseline in the same pull request.

### Pull-request checklist

- Target `dev` unless a maintainer requested a release or hotfix against `main`.
- Format the pull-request title as `<type>: <subject>` or `<type>(<scope>): <subject>`.
- Link the issue and describe user impact.
- Prove the behavior with tests or datasets.
- Update both Korean and English documents for changed concepts.
- Check for generated output, secrets, and real personal data.
- For policy changes, attach `policy:validate` and benchmark summaries.
- Respond to review in a new commit and leave evidence before resolving a thread.

### Designing a good first issue

Keep one issue to a unit that can be completed in 30–90 minutes. Include exact files, allowed and forbidden scope, a fixture, commands to run, and pass criteria; label it `good first issue` plus its area. Five ready-to-file designs are in the [good-first-issue catalog](docs/contributing/good-first-issues.en.md).
