# CI and quality gates / CI 및 품질 게이트

GitHub Actions uses four stable aggregate checks. Branch protection should require
the exact names below; individual matrix job names are intentionally not part of
the branch-protection contract.

GitHub Actions는 아래 네 개의 고정 집계 체크를 사용합니다. 브랜치 보호 규칙에는
매트릭스 내부 작업명이 아니라 아래 이름을 정확히 등록합니다.

- `required / ci`
- `required / policy-benchmark`
- `required / licenses`
- `required / containers`

An administrator can initialize or converge `main` protection with the checked-in
baseline:

관리자는 저장소에 포함된 매니페스트로 기존 리뷰/force-push 설정을 건드리지 않고
필수 체크를 적용할 수 있습니다.

```bash
GH_REPO=2026-OSS-Contest/GuradMCP-KR scripts/ci/configure-required-checks.sh
```

The command requires one approving review, dismisses stale approvals, requires all
review conversations to be resolved, and blocks force-pushes and deletion. The
source of truth for check names is
[`.github/required-checks.json`](../../.github/required-checks.json).

## Test layers / 테스트 계층

| Check | Command | Scope |
| --- | --- | --- |
| `quality / lint-typecheck` | `npm run lint`, `npm run typecheck` | TypeScript workspaces |
| `test / vitest` | `npm test` | Gateway and package unit/integration tests |
| `test / junit5-kotest` | `services/control-plane/gradlew -p services/control-plane test` | Spring control plane |
| `test / playwright` | `npm run test:e2e` | Console browser flows |
| `test / gmcp-30-compose` | `scripts/compose-up.sh demo` | Cold demo-stack startup and health checks within 300 seconds |
| `quality / workflow-lint` | `actionlint` | `.github/workflows/*.yml` |

Failed test reports are uploaded for 14 days. Node, Gradle, and Docker Buildx use
their native GitHub Actions caches; redundant runs on the same PR are cancelled.
The GMCP-30 job includes image builds in its five-minute wall-clock limit, uploads
the readiness JSON and Compose diagnostics, and always removes containers and
volumes after the check.

## Policy-pack benchmark contract / 정책팩 벤치마크 계약

The benchmark check runs on every push to `main`, weekly, and whenever a PR changes
a policy pack, benchmark dataset/scenario, detector, gateway, policy engine, or the
benchmark scripts. On unrelated PRs the same stable check completes as a documented
no-op so branch protection never waits for a path-filtered workflow.

`npm run bench -- --output <path>` must create a JSON report. The runner also sets
`GUARDMCP_BENCHMARK_REPORT`, `BENCHMARK_REPORT_PATH`, and `BENCHMARK_OUTPUT` to that
absolute path. A producer may use any of these compatible shapes:

```json
{
  "metrics": {
    "recall": 0.92,
    "falsePositiveRate": 0.04,
    "p95LatencyMs": 42.1
  }
}
```

Percent values may be ratios (`0.92`) or percentages (`92`). A confusion matrix
(`tp`, `fn`, `fp`, `tn`) and raw `latenciesMs` are also accepted. Missing metrics
fail closed. Thresholds in [`scripts/ci/quality-gates.json`](../../scripts/ci/quality-gates.json)
implement the 12.2/NFR-01 gate:

- Recall **>= 90%**
- False-positive rate **<= 5%**
- Rule-pipeline p95 for a 10 KiB payload **<= 50 ms**

The raw JSON and Markdown verdict are retained as the `policy-benchmark-*` artifact
for 30 days.

## Dependency license report / 의존성 라이선스 리포트

The license workflow resolves npm and Gradle dependencies, then publishes JSON, CSV,
and Markdown inventories. An unknown license is reported explicitly instead of being
silently omitted. Reports are retained for 90 days and regenerated for PRs, `main`,
the weekly schedule, and manual dispatches.

## GHCR multi-architecture images / GHCR 멀티 아키텍처 이미지

Every PR builds `linux/amd64` and `linux/arm64` images for `gateway`, `control-plane`,
`console`, `demo-agent`, and `demo-mcp-tools`. Images are pushed only by a `main`
branch push. GHCR packages use the names `guardmcp-<service>` and receive `latest`,
branch, and immutable `sha-*` tags as applicable.
