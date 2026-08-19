# guardmcp CLI

[English](README.en.md) | **한국어**

`packages/cli` (`@guardmcp/cli`)는 시나리오 재생, 벤치마크, 정책 검증을 스크립트화하는 얇은 오케스트레이션 계층입니다(GMCP-97). 이 CLI는 새로운 판정 로직을 갖지 않습니다 — 모든 명령은 이미 존재하는 모듈을 호출하는 얇은 래퍼입니다.

| 명령 | 위임 대상 |
| --- | --- |
| `guardmcp demo` | `attack-lab/runner/runner.ts`의 `runCatalog()` |
| `guardmcp bench` | `attack-lab/benchmark/benchmark.ts`의 `runBenchmark()` |
| `guardmcp policy lint` | `@guardmcp/policy-engine`의 loader(`parsePolicyFile`, `loadPolicyPacks`) |

## 실행 방법

빌드 산출물 없이 `tsx`로 소스를 직접 실행합니다(아래 "설계 결정" 참고). 세 가지 동등한 실행 경로가 있습니다.

```bash
npm run cli -- <command>              # 저장소 루트에서, npm scripts로
npx tsx packages/cli/src/index.ts <command>  # 직접 tsx로
guardmcp <command>                    # npm install 이후 workspace bin 심볼릭 링크
```

## 명령어

### `guardmcp demo`

Attack Lab 카탈로그(T-01~T-09, `attack-lab/scenarios/catalog.json`)를 재생합니다.

```
guardmcp demo list
guardmcp demo run <scenarioId|threatId|all> [--target guarded|vulnerable] [--seed <n>] [--record <path>]
```

* `<scenarioId|threatId|all>`: 시나리오 id(`A-01`), threat id(`T-01`, 소속 시나리오 전체 실행), 또는 `all`(카탈로그 전체).
* `--target`: `guarded`(기본값, 게이트웨이 파이프라인 통과) 또는 `vulnerable`(검사 없음, "before" 재현). `runCatalog()`의 `mode` 옵션에 대응합니다.
* `--seed`: 리포트의 `sessionId`를 `attacklab-seed-<n>`으로 고정합니다. 판정(verdict)은 파이프라인에 무작위성이 없어 항상 결정론적이며, `--seed` 유무와 무관합니다. 다만 각 스텝의 `eventId`와 타임스탬프는 고정하지 않습니다 — 이 두 값이 실행마다 달라져도 `--record` 출력의 판정/등급은 동일합니다.
* `--record <path>`: 실행 결과(RunReport) JSON을 지정 경로에 저장합니다.
* 종료 코드: `guarded` 모드에서 시나리오 등급이 `fail`이면 non-zero(1). `vulnerable` 모드는 채점 대상이 아니므로 항상 0입니다.

### `guardmcp bench`

`policy-packs/`와 `attack-lab/datasets/`, `attack-lab/policy-fixtures/` 전체를 대상으로 Recall/FPR/Precision/p95 지연 등 KPI를 계산합니다.

```
guardmcp bench run [--format json|md|html] [--output <path>]
guardmcp bench run --dry-run-only [--dataset <path>] [--fail-on-fpr <0..1>]
guardmcp bench compare <baseline.json> <current.json>
```

* `--format`: 표준출력 형식만 제어합니다 — `json`(기본값, 전체 리포트), `md`(핵심 KPI 표), 또는 `html`(콘솔과 같은 디자인 토큰으로 스타일한 단일 HTML 파일, 외부 요청 없음). `html`은 `packages/design-tokens`의 색상·간격·모서리 반경 토큰을 인라인 `<style>`로 그대로 쓰지만, 그 패키지의 타이포그래피 클래스가 지정하는 "SUIT"/"JetBrains Mono" 폰트는 이 CLI가 배포하지 않으므로 쓰지 않습니다 — 대신 시스템 폰트 스택을 씁니다(오프라인에서도 항상 올바르게 렌더링되어야 하기 때문). 자세한 내용은 아래 "설계 결정" 참고.
* `--output <path>`: 지정하면 `--format`이 만든 내용을 그 경로에 그대로 저장합니다(`--format html`이면 HTML, `md`면 마크다운). 지정하지 않으면 아무 렌더링 파일도 만들지 않고 표준출력에만 찍습니다. `--format`과 무관하게, `bench compare`가 읽을 JSON 리포트는 항상 `reports/benchmark.json`(또는 `GUARDMCP_BENCHMARK_REPORT` 환경변수) 경로에 별도로 보장됩니다 — `--output`이 그 경로 자체를 가리키면서 `--format json`이 아닌 이상, 두 파일이 따로 생깁니다.
* `--dry-run-only`(SPEC-POL-04 §7.1, GMCP-77): `runBenchmark()`의 고정 KPI 평가 대신, 라벨된 정상(`label: false`) 데이터셋을 `evaluationMode: "shadow-all"`로 재생해 정책별 FPR(오탐률)을 계산합니다 — 실제 정책의 `dry_run` 값과 무관하게 매칭된 모든 정책을 shadow로 취급하므로, 아직 어떤 조치도 실행되지 않습니다. `--dataset <path>`: `{id, label, text}[]` 형태의 JSON 파일(기본값 `attack-lab/datasets/pii-benchmark.json`의 `label: false` 샘플 — 설계 문서 §7.1이 이름 붙인 `attack-lab/datasets/normal-kr-v1`은 이 저장소에 아직 없습니다). `--fail-on-fpr <0..1>`(§7.2 CI 게이트): 정책 하나라도 이 임계값을 넘으면 non-zero로 종료하고 위반 정책 목록을 표준에러에 출력합니다. `CONTROL_PLANE_URL`이 설정되어 있으면 각 정책의 결과를 `POST /api/v1/policies/{id}/benchmark-results`로도 보고합니다(연결 실패는 경고만 남기고 무시 — CI에는 컨트롤 플레인이 없습니다).
* `bench compare`는 두 리포트(JSON)를 비교합니다. `current`가 자체 KPI 임계치(`recall ≥ 90%`, `fpr ≤ 5%`, `p95 ≤ 50ms` 등)를 만족하지 못하거나, `baseline` 대비 회귀 허용치(recall −1%p, fpr +1%p, p95 +5ms)를 벗어나면 실패합니다. 둘 중 하나만 걸려도 실패합니다 — baseline 비교는 KPI 게이트를 대체하지 않습니다.
* 종료 코드: `bench run`은 리포트의 `passed`가 false면 non-zero. `bench run --dry-run-only`는 `--fail-on-fpr`을 넘긴 정책이 있으면 non-zero. `bench compare`는 위 두 조건 중 하나라도 걸리면 non-zero.

### `guardmcp policy lint`

정책 DSL(부록 A) 문서를 스키마·의미 양쪽으로 검증합니다.

```
guardmcp policy lint <path-or-glob>
guardmcp policy lint --pack <packName>
```

* `<path-or-glob>`: 단일 파일, 디렉터리(재귀적으로 `*.yaml`/`*.yml` 수집), 또는 glob 패턴(`policy-packs/**/*.yaml`).
* `--pack <name>`: `policy-packs/` 전체를 스캔해 지정한 팩의 오류만 보고합니다(다른 팩과의 `id` 충돌도 함께 잡아냅니다).
* 검증 항목: 스키마(`id`/`pack`/`priority`/`match`/`action`/`severity` 필수 필드), `action`/`severity`/`direction` 허용 집합, 정책 id 중복(검사 대상 파일 범위 내), `require_approval`의 `approval.timeout_seconds`/`approval.on_timeout` 누락 여부, `*_regex` 필드의 안전성(ReDoS 방지).
* 종료 코드: 오류 1건 이상이면 non-zero.
* **`npm run policy:validate`와의 관계**: 이 명령은 저장소 전체 CI 게이트를 대체하지 않습니다. `npm run policy:validate`(`scripts/validate-policies.ts`)는 manifest semver, `dsl_version`, `evaluation_strategy` 허용 값, `pack.yaml`의 `policies` 목록 일치, `extends` 순환/버전 호환성, `reasonCode` 허용 목록까지 추가로 검사하는 더 엄격한 게이트이며, 정책팩 PR의 CI 게이트로는 계속 `npm run policy:validate`를 사용합니다. `guardmcp policy lint`는 정책 작성 중 파일 단위로 빠르게 피드백을 받기 위한 도구입니다.

## 설계 문서 대비 범위 결정

설계 문서(§7 미결 사항 포함) 대비 실제 구현에서 내린 결정과 그 이유입니다.

* **`demo`에 `--endpoint` 없음**: 설계 문서는 `demo`가 게이트웨이에 실제 MCP 트래픽을 발생시킨다고 서술하지만, `attack-lab/runner/runner.ts`는 "게이트웨이의 HTTP 표면은 의도적으로 관여하지 않는다 — 시나리오는 아무것도 실행 중이지 않아도 CI에서 재현 가능해야 한다"고 명시하고, `guardmcp` CLI(GMCP-97)를 `runCatalog()`를 호출하는 두 진입점 중 하나로 직접 지목합니다. 이 CLI는 이미 구현된 코드의 계약을 따랐습니다.
* **`bench run`(기본 모드)에 `--dataset`/`--policy-pack` 없음**: `runBenchmark()`는 `policy-packs/` 전체와 고정된 데이터셋 묶음을 항상 평가하며 부분 실행 훅이 없습니다. 구현되지 않은 필터를 조용히 무시하는 대신 아예 노출하지 않았습니다. `--dry-run-only`(GMCP-77)는 별도의 평가 경로이므로 이 제약과 무관하게 `--dataset`을 받습니다.
* **`bench run --format html`은 `packages/design-tokens`의 색상·간격 토큰만 공유하고 폰트는 공유하지 않음**: 설계 문서 §7의 미결 사항은 GMCP-116(`packages/design-tokens` 분리)으로 해소됐습니다. 이 CLI는 그 패키지의 `tokens.css`에서 `:root` 원시값 블록만 인라인으로 가져다 씁니다. 같은 파일의 타이포그래피 클래스(`.text-*`)는 "SUIT"/"JetBrains Mono" 웹폰트를 전제하는데, 이 CLI는 그 폰트를 배포하지도 네트워크로 받아오지도 않으므로 그 클래스들은 아예 쓰지 않고 리포트 자체 CSS에 시스템 폰트 스택(`ui-sans-serif, system-ui, ...` / `ui-monospace, ...`)을 지정합니다.
* **`policy lint --strict` 없음**: 설계 문서는 `--strict`가 경고를 오류로 승격시킨다고 서술하지만, 현재 loader(`packages/policy-engine/src/loader`)는 `error`/`critical` 두 등급만 내며 별도의 "경고" 등급이 없습니다. 아무것도 바꾸지 못하는 플래그를 받아들이는 대신 구현하지 않았습니다.
* **`bench compare`의 회귀 판단(§7 미결 사항)**: 절대값과 baseline 대비 변화율 중 절대 허용치(recall/fpr ±1%p, p95 +5ms)를 선택했고, 여기에 `current` 자체의 고정 KPI 임계치 재확인을 더했습니다 — baseline이 나쁜 상태였다면 그 나쁜 상태를 통과 기준으로 삼지 않기 위해서입니다.

## 왜 tsx로 실행하는가 (빌드 산출물 없음)

`packages/cli`는 `attack-lab/`(자체 `package.json`이 없는 순수 TypeScript 소스 트리)에 상대 경로로 접근합니다. `packages/gateway`, `packages/policy-engine`처럼 `rootDir: "src"`로 `tsc` 빌드를 하면 `attack-lab/` 임포트가 rootDir 밖이라 컴파일이 거부됩니다. 대신 이 패키지는 `attack-lab/*.ts`, `scripts/*.ts`와 같은 방식 — 소스를 `tsx`로 직접 실행하고, 타입 검사는 저장소 루트의 `tsconfig.tools.json`(`packages/cli/**/*.ts` 포함)이 담당합니다. `bin/guardmcp.mjs`는 `tsx/esm/api`의 `register()`로 이 로더를 등록한 뒤 `src/index.ts`를 동적 import합니다.
