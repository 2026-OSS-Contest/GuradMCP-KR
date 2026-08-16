# 정책 작성 가이드 — DSL v1

[English](README.en.md) | **한국어**

이 문서는 Appendix A 정책 DSL v1의 작성자용 레퍼런스입니다. 처음 읽는 사람도 이 문서와 예제만으로 정책 한 건을 만들고 검증할 수 있도록, 정책 구조부터 PR 벤치마크 게이트까지 한 흐름으로 설명합니다.

## 1. 10분 안에 첫 정책 만들기

1. `policy-packs/default/policies/block-env-file-read.yaml`을 같은 팩 안에서 복사합니다.
2. 파일명과 `id`를 바꾸고, 아래 예제처럼 `match`를 가장 좁게 작성합니다.
3. `npm run policy:validate`로 구조를 검사합니다.
4. 공격/정상 fixture를 추가한 뒤 `npm run bench`로 회귀가 없는지 확인합니다.

```yaml
id: block_private_key_read
pack: default
version: 1
description: private key 파일 읽기 차단
priority: 110
match:
  direction: request
  tool: read_file
  server_trust: any
  args:
    path_regex: '(^|/)(id_(rsa|ed25519)|[^/]+\.pem)$'
action: block
severity: critical
message: 비밀 키 파일 접근이 정책에 의해 차단되었습니다.
```

파일을 `policy-packs/default/policies/block-private-key-read.yaml`로 저장합니다. `id`는 전체 활성 정책 그래프에서 유일해야 하며, 예제 값은 실제 비밀값이나 개인정보를 포함하면 안 됩니다.

## 2. 정책 문서 전체 구조

| 필드 | 필수 | 타입/값 | 의미 |
| --- | --- | --- | --- |
| `id` | 예 | snake_case 문자열 | 감사 로그와 UI에 기록되는 안정적인 전역 식별자 |
| `pack` | 예 | 팩 이름 | 소속 manifest의 `name`과 일치 |
| `version` | 예 | `1` | DSL major version |
| `description` | 권장 | 문자열 | 사람이 이해할 정책 목적 |
| `priority` | 예 | 0 이상의 정수 | 낮을수록 먼저 평가 |
| `match` | 예 | 객체 | 아래 여섯 조건 축. 서로 다른 축은 AND |
| `action` | 예 | 다섯 값 중 하나 | 매칭 시 후보 판정 |
| `severity` | 예 | 다섯 값 중 하나 | 사건의 보안 중요도 |
| `message` | 권장 | 문자열 | 민감 원문 없는 사용자 메시지 |
| `approval` | 조건부 | 객체 | `require_approval`일 때 필수 |

알 수 없는 필드, 잘못된 enum, 빈 `match`, 중복 `id`, 팩 이름 불일치는 validation 오류입니다. 정규식은 YAML single quote로 감싸 역슬래시 해석을 피하는 것을 권장합니다.

## 3. `match` 여섯 축

한 정책의 서로 다른 축은 **모두 만족(AND)** 해야 합니다. 같은 축의 `any_of` 또는 목록은 명시된 OR 규칙을 사용합니다. 특정 축을 생략하면 그 축은 제한하지 않습니다. 단, 의도를 분명히 하기 위해 `direction`, `tool`, `server_trust`를 명시하는 편을 권장합니다.

### 3.1 `direction`

| 값 | 검사 대상 |
| --- | --- |
| `request` | Agent에서 MCP Tool로 나가는 호출과 인자 |
| `response` | MCP Tool에서 Agent로 들어오는 결과와 description |
| `any` | 양방향 |

위험 도구/대상은 보통 `request`, PII 유출과 간접 인젝션은 보통 `response`에서 평가합니다. 양방향이 꼭 필요한 경우가 아니면 `any`를 피하면 오탐을 줄일 수 있습니다.

**방향별 강도 차이 (FR-INJ-03).** `default` 팩은 같은 인젝션 탐지에 방향별로 다른 강도를 적용합니다. 응답 방향은 Agent가 곧 신뢰할 외부 데이터이므로 `block_untrusted_injection_response`가 **차단**하고, 요청 방향은 사용자·Agent가 직접 쓴 텍스트라 같은 표현이 정당한 인용일 수 있어 `warn_injection_request`가 **경고로 기록만** 합니다. 즉 동일한 페이로드라도 방향에 따라 verdict가 달라집니다. 새 탐지 정책을 쓸 때도 이 비대칭을 유지하세요 — 요청 방향까지 차단하면 정상 업무가 막힙니다.

**자격증명도 같은 비대칭을 씁니다.** 응답에 실려 온 Secret은 `mask_secret_response`가 **마스킹 후 전달**합니다 — 조회 자체는 정당한 업무이므로 막을 일이 아니고, Agent가 키를 볼 이유만 없애면 됩니다. 반대로 Agent가 **보내려는** 요청에 Secret이 있으면 `approve_external_email_with_secret`가 **사람 승인**을 요구합니다. 요청 방향에서 마스킹으로 처리하면 유출 시도를 막는 게 아니라 가려 버리게 됩니다.

### 3.2 `tool`

문자열 하나이며 정확 일치 또는 glob(`*`, `?`)입니다.

```yaml
tool: send_email   # exact
tool: read_*       # glob
tool: '*'          # 모든 tool; 좁은 다른 조건과 함께 사용
```

glob은 전체 tool 이름에 매칭하며 대소문자를 구분합니다. 정규식은 허용하지 않습니다. tool 이름이 없는 response에서는 원래 request의 tool 이름을 사용합니다.

### 3.3 `server_trust`

| 값 | 의미 |
| --- | --- |
| `trusted` | 소유·운영과 정의 snapshot이 검증된 서버 |
| `limited` | 일부 사용은 승인됐지만 권한/데이터 범위가 제한된 서버 |
| `untrusted` | 외부 또는 검증되지 않은 서버 |
| `any` | 모든 신뢰 등급 |

서버를 찾을 수 없거나 trust 설정이 없으면 fail-safe로 `untrusted`로 정규화합니다. 정책의 `any`는 이 분류와 무관하게 매칭합니다.

목록으로도 지정할 수 있습니다(`server_trust: [limited, untrusted]`). 목록 안의 값은 OR로 평가되어 "trusted를 제외한 모든 등급"류의 정책을 등급 하나하나 나열하지 않고 표현할 수 있습니다. 목록 안에는 `any`를 섞어 쓸 수 없습니다.

### 3.4 `args`

요청 인자(JSON object)에 대한 조건 맵입니다. 키는 최상위 인자 이름과 연산자를 `_`로 연결합니다. v1 연산자는 다음과 같습니다.

| 형태 | 값 | 의미 |
| --- | --- | --- |
| `<name>` | scalar | 정확 일치 |
| `<name>_regex` | 문자열 | 문자열화된 값에 JavaScript 정규식 안전 부분집합으로 전체/부분 매칭(최대 512자, backreference·lookbehind·중첩/교대 그룹 반복 금지) |
| `<name>_glob` | 문자열 | 문자열화된 값에 glob 매칭 |
| `<name>_in` | 목록 | 목록 중 하나와 정확 일치 |
| `<name>_not_in` | 목록 | 어떤 목록 값과도 정확 일치하지 않음 |
| `<name>_domain` | 도메인 목록 | 이메일/URL host가 허용 도메인과 같거나 하위 도메인 |
| `<name>_not_domain` | 도메인 목록 | 이메일/URL host가 어떤 도메인에도 속하지 않음 |
| `<name>_exists` | boolean | 필드 존재 여부 |

한 `args` 객체 안의 조건은 모두 AND입니다. 누락된 인자는 `*_exists: false` 외에는 매칭 실패입니다. 도메인은 소문자화하고 trailing dot을 제거한 뒤 라벨 경계로 비교하므로 `evilcompany.co.kr`는 `company.co.kr`에 속하지 않습니다.

```yaml
args:
  path_regex: '(^|/)(\.env(\..*)?|id_rsa|credentials(\.json)?)$'
  mode_in: [read, preview]
  recursive: false

args:
  to_not_domain: [company.co.kr]
  body_exists: true
```

**`path_regex`는 특별합니다 (FR-SEC-04).** `<name>`이 정확히 `path`일 때만 매처가 `path`, 없으면 `file_path`, 그다음 `filename` 순으로 첫 문자열 필드를 찾고, 매칭 전에 정규화합니다 — 반복 percent-decode(최대 3회), NFKC, null byte 절단과 제어문자 제거, `~`/`$HOME` 확장, `.`/`..` 경로 해석, 소문자화 순입니다(`packages/policy-engine/src/pathNormalize.ts`). 정규화한 전체 경로와 basename 양쪽에 정규식을 적용하므로 `./config/../.env`, `%2e%65%6e%76`, `id_rsa%00.png`, `~/credentials.json` 같은 변형도 `.env`/`id_rsa`/`credentials.json`으로 귀결되어 매칭됩니다. `path`가 아닌 다른 `<name>_regex`는 이 정규화를 거치지 않고 원래 값 그대로 매칭합니다.

### 3.5 `detections`

Detector가 만든 정규화 tag를 평가합니다. tag는 `SECRET`, `INJECTION.INDIRECT`, `PII.PHONE`, `PII.RRN_LIKE`처럼 점으로 계층화합니다. 상위 tag `PII`는 모든 `PII.*`와 매칭합니다.

| 키 | 규칙 |
| --- | --- |
| `any_of` | 목록 중 하나 이상이 존재 |
| `all_of` | 목록의 모든 tag가 존재 |
| `none_of` | 목록의 어떤 tag도 존재하지 않음 |

`any_of`, `all_of`, `none_of`를 함께 쓰면 세 조건을 모두 만족해야 합니다. detector가 실행되지 않은 상태는 빈 detection 집합이며 `none_of`만 만족할 수 있습니다.

```yaml
detections:
  any_of: [SECRET, PII.RRN_LIKE]
  none_of: [TEST_FIXTURE]
```

### 3.6 `risk_score`

정규화된 0–100 정수 위험 점수를 비교합니다.

| 키 | 의미 |
| --- | --- |
| `gte` | 점수 ≥ 값 |
| `lte` | 점수 ≤ 값 |

하나 또는 둘을 쓸 수 있습니다. 둘을 쓰면 닫힌 구간이며 `gte <= lte`여야 합니다. 점수가 아직 계산되지 않은 이벤트는 risk 조건과 매칭하지 않습니다.

점수를 만드는 가중치와 밴드(warn 40 / approval 70 / block 90)는 [위험 점수 산식](../risk-scoring.md)에 있습니다.

```yaml
risk_score:
  gte: 70
  lte: 89
```

## 4. 다섯 action

| action | 의미 | 실행/기록 |
| --- | --- | --- |
| `allow` | 명시적 통과 | 원본으로 실행하고 매칭 정책을 기록 |
| `warn` | 경고 후 통과 | 원본으로 실행, 콘솔 경고와 감사 이벤트 기록 |
| `mask_then_allow` | 탐지 span 마스킹 후 통과 | 마스킹본만 전달; 원문은 기본적으로 저장하지 않음 |
| `require_approval` | 사람 결정까지 보류 | timeout 동안 실행하지 않고 Approval Card 게시 |
| `block` | 즉시 차단 | tool을 호출/응답 전달하지 않고 민감 원문 없는 오류 반환 |

정책 action의 강도는 `block > require_approval > warn > mask_then_allow > allow`입니다. `warn`이 `mask_then_allow`보다 강한 순서는 Appendix A v1의 판정 합성 규칙이며, severity와 별개입니다.

이 절은 DSL v1의 규범 계약입니다. 현재 데모 Gateway는 체크인된 팩을 평가해 `allow`/`warn`/`mask_then_allow`/`block`을 적용합니다. `docker compose`가 `CONTROL_PLANE_URL`을 기본으로 주입하는 데모 환경에서는 `require_approval`이 실제 Control Plane 승인으로 이어져, 운영자가 결정하거나(승인/마스킹 후 승인/거부) timeout(120초) 동안 무응답이면 자동으로 fail-closed 차단됩니다. `CONTROL_PLANE_URL`이 없으면 즉시 fail-closed로 거부합니다. 승인 카드는 이제 실제로 위험 태그와 마스킹 미리보기를 담아 게시되지만, 콘솔 승인 UI·Replay·해시 체인은 아직 이 승인 이벤트와 연동되지 않았습니다 — 자세한 내용은 [외부 이메일 승인 데모](../external-email-approval-demo.md)를 참고하세요. 영구 감사 로그는 구현 예정이며 데모에서 제공된다고 가정하면 안 됩니다.

## 5. severity 다섯 단계

| severity | 사용 기준 | 예 |
| --- | --- | --- |
| `info` | 보안 영향 없는 관찰 | 명시적 allow 감사 |
| `low` | 낮은 확신 또는 작은 영향 | 신뢰 서버의 약한 패턴 |
| `medium` | 검토가 필요한 현실적 위험 | 제한 서버의 위험 tool |
| `high` | 민감정보 유출 또는 고권한 작업 가능 | 외부 이메일 + PII |
| `critical` | 자격증명/권한 탈취가 즉시 가능한 명백한 위반 | `.env`·private key 읽기 |

severity는 설명·정렬·알림에 쓰이며 action을 자동 선택하지 않습니다. 예를 들어 `severity: critical`과 `action: warn`을 함께 쓸 수는 있지만, 의도를 리뷰에서 명확히 설명해야 합니다.

## 6. 평가 순서, 전략, 우선순위와 기본값

1. 활성 팩의 `extends`를 위상 정렬하고 부모를 먼저 로드합니다. 순환 참조, 없는 팩, 중복 정책 ID는 시작/validation 오류입니다.
2. 활성 정책을 `priority` 오름차순, 동률이면 `id` 사전순으로 평가합니다.
3. 각 정책의 서로 다른 `match` 축은 AND로 평가합니다.
4. manifest의 `evaluation_strategy`가 결과를 합성합니다.
   - `first-match`: 첫 매칭 정책의 action을 즉시 채택합니다.
   - `severity-max`(기본): 모든 매칭 정책을 평가하고 action 강도가 가장 높은 후보를 채택합니다. 동률이면 severity(`critical`→`info`), priority, id 순으로 대표 정책을 정합니다.
5. 어떤 정책도 매칭되지 않으면 최종 활성 팩의 `default_action`을 사용합니다. 생략 시 일반 모드는 `allow`, strict 모드는 `warn`입니다.
6. 모든 판정 이벤트에는 대표 정책뿐 아니라 매칭된 정책 ID 전체를 evaluation 순서로 기록합니다.

`first-match`에서는 넓은 allow보다 구체적인 block/approval에 더 낮은 priority 숫자를 주어야 합니다. `severity-max`에서도 priority는 대표 근거와 결정론을 위해 유지합니다.

## 7. `approval` 블록

`action: require_approval`이면 필수이고 다른 action에는 쓰지 않습니다.

```yaml
approval:
  timeout_seconds: 120
  on_timeout: block
  allow_masked_approval: true
```

| 필드 | v1 규칙 | 기본값 |
| --- | --- | --- |
| `timeout_seconds` | 1–3600 정수 | `120` |
| `on_timeout` | v1은 fail-closed를 위해 `block`만 허용 | `block` |
| `allow_masked_approval` | 운영자에게 "마스킹 후 승인" 선택을 제공 | `true` |

운영자는 차단, 마스킹 후 승인(허용된 경우), 그대로 승인 중 하나를 선택합니다. 처리자, 시각, 선택, 매칭 정책을 감사 로그에 남깁니다. timeout 전에는 upstream tool을 실행하지 않습니다.

## 8. 정책팩 구조, manifest와 `extends`

```text
policy-packs/
  default/
    pack.yaml
    policies/
      block-env-file-read.yaml
      block-injection-response.yaml
      require-approval-external-secret-email.yaml
  korean-pii/
    pack.yaml
    policies/
      mask-korean-pii-response.yaml
      require-approval-external-pii-email.yaml
```

`pack.yaml` 예:

```yaml
name: korean-pii
version: 1.0.0
description: 한국형 PII 마스킹과 외부 반출 제어
dsl_version: 1
default_action: allow
evaluation_strategy: severity-max
extends:
  - default@^1.0.0
policies:
  - policies/mask-korean-pii-response.yaml
  - policies/require-approval-external-pii-email.yaml
```

- `name`은 directory와 각 정책의 `pack`과 같아야 합니다.
- `version`은 정책팩 SemVer입니다. 정책 의미 변경은 version을 올립니다.
- `dsl_version`은 이 문서에서는 `1`입니다.
- `default_action`은 다섯 action 중 하나지만 안전한 재사용을 위해 `allow` 또는 `warn`을 권장합니다.
- `evaluation_strategy`는 `severity-max` 또는 `first-match`입니다.
- `extends`는 `pack@semver-range` 목록입니다. 부모를 먼저 적용하고 child manifest가 strategy/default를 정합니다.
- `policies`는 팩 directory 기준 상대 파일이며 나열 순서가 아니라 `priority`가 평가 순서를 정합니다.

`extends`로 로드된 전체 그래프에서 policy `id`가 중복되면 조용히 override하지 않고 오류로 중단합니다. 기존 정책을 바꾸려면 부모의 새 버전에 변경을 제안하거나 새 `id`와 더 강한 조건을 추가하세요.

## 9. 주석이 있는 레퍼런스 예제

### `default`

[`block-env-file-read.yaml`](../../policy-packs/default/policies/block-env-file-read.yaml)은 request/tool/args를 조합해 자격증명 경로를 차단합니다. [`block-injection-response.yaml`](../../policy-packs/default/policies/block-injection-response.yaml)은 response/detections/server trust/risk score를 조합합니다. [`require-approval-external-secret-email.yaml`](../../policy-packs/default/policies/require-approval-external-secret-email.yaml)은 approval 블록 전체를 보여 줍니다.

### `korean-pii`

[`mask-korean-pii-response.yaml`](../../policy-packs/korean-pii/policies/mask-korean-pii-response.yaml)은 tool response의 `PII.*` span만 마스킹합니다. [`require-approval-external-pii-email.yaml`](../../policy-packs/korean-pii/policies/require-approval-external-pii-email.yaml)은 외부 도메인과 PII가 함께 있을 때 사람 승인을 요구합니다. 팩이 [`default`](../../policy-packs/default/pack.yaml)를 extends하는 방법은 [`pack.yaml`](../../policy-packs/korean-pii/pack.yaml)에 있습니다.

## 10. 작성, 검증, 벤치마크와 PR

```bash
# 1) YAML/manifest/enum/중복 ID 검사 + Gateway runtime 정책 번들 생성
npm run policy:validate

# 2) recall, FPR, 공격 차단율, 10KB p95 검사
npm run bench

# 3) 필요하면 전체 로컬 게이트
npm run check
```

`npm run policy:validate`는 schema 검증에 성공하면 `packages/gateway/src/policies.generated.ts`를 결정론적으로 다시 생성합니다. 정책팩을 바꾼 기여자는 이 생성 파일 변경도 같은 commit에 포함합니다. CI는 생성 결과가 YAML manifest/policy와 다르면 fail-closed로 실패하며, 생성 파일을 직접 편집해서는 안 됩니다.

정책에는 최소 한 개 매칭 fixture와 한 개 비매칭 fixture를 추가하세요. detector 정책은 합성 양성·음성 데이터를 함께 추가합니다. PR 본문에는 의도된 verdict 변화, benchmark의 recall/FPR/p95/block rate, baseline과의 차이를 적습니다. 정확한 기준과 실패 처리 절차는 [정책팩 벤치마크 게이트](../benchmark-gate.md)에 있습니다.

### 회귀 fixture 계약

정책 회귀용 YAML fixture만 `attack-lab/policy-fixtures/<기여명>/` 아래에 둡니다. 일반 PII/공격 데이터셋은 `attack-lab/datasets/`에 유지하며 fixture로 자동 변환되지 않습니다. Benchmark Runner는 fixture 디렉터리의 `.yaml`·`.yml` 파일을 재귀적으로 찾아 모든 배포 정책으로 평가합니다. 실제 action 또는 매칭 ID가 기대값과 다르거나 schema가 잘못되면 실패하며, JSON 리포트에 모든 fixture ID와 결과를 기록합니다. 배포되는 정책마다 `match` 한 건과 `not_match` 한 건이 모두 있어야 합니다.

```yaml
id: unique_synthetic_fixture_id
coverage:
  policy_id: your_policy_id
  expectation: match # 반대 fixture에는 not_match
event:
  direction: response
  tool: fetch_url
  server_trust: untrusted
  args: {} # 선택; 사용하지 않으면 생략
  detections: [INJECTION.OBFUSCATED]
  risk_score: 85
  content: 합성 텍스트만 사용합니다. content는 의도 설명용이며 DSL v1 조건에는 쓰지 않습니다.
expected:
  action: block
  matched_policy_ids: [your_policy_id]
```

`id`는 안정적이고 유일해야 하며 `coverage.policy_id`는 실제 정책 ID를, `coverage.expectation`은 `match` 또는 `not_match`를 사용합니다. `expectation`은 `expected.matched_policy_ids`와 일치해야 합니다. enum과 탐지 tag는 이 가이드를 따릅니다. 정상 fixture는 보통 팩의 기본 action과 빈 `matched_policy_ids`를 기대합니다. 두 fixture 모두 합성 내용만 사용하세요. `npm run bench` 결과에서 `metrics.fixturePassRate`와 `metrics.fixtureCoverageRate`가 모두 `1`인지, `metrics.authorFixtures`가 정책 수의 두 배 이상인지, `fixtures` 배열에 추가한 각 ID가 `passed: true`로 나오는지 확인합니다.

### Policy Unit Test Framework (결정론적 정책 단위 테스트)

`npm run bench`(Benchmark Runner)가 recall/FPR 같은 통계적 성능을 측정한다면, `packages/policy-engine/test/policy-table.test.ts`는 그보다 하위 레벨에서 "정책 하나하나가 명세대로 판정하는가"를 결정론적으로 검증하는 별도 게이트입니다. `policy-packs/default/`의 모든 정책 파일은 대응하는 케이스 파일이 있어야 하며, 없으면 커버리지 스크립트가 CI를 실패시킵니다.

1. `policy-packs/<pack>/policies/<policy-file>.yaml`을 작성합니다.
2. `packages/policy-engine/test/fixtures/<pack>/<policy-id>.cases.yaml`을 작성합니다 (`id`의 kebab-case 표기가 파일명). 정책 1개당 최소 1개의 양성 케이스(정책이 매칭되어 지정된 action이 나오는 경우)가 필요합니다.
3. `npm run test:policy --workspace @guardmcp/policy-engine`을 로컬에서 실행한 뒤 PR을 생성합니다.
4. CI의 `policy-tests` 워크플로 통과를 확인합니다.

케이스 파일의 3튜플 스키마(policy YAML + 입력 컨텍스트 + 기대 verdict)는 `docs/task-docs/GMCP-16/policy-unit-test-framework.md` §4를 참고하세요.

## 11. 작성자 자가 점검

- [ ] 전역에서 유일하고 의미가 안정적인 `id`인가?
- [ ] `direction`, `tool`, `server_trust`가 필요 이상 넓지 않은가?
- [ ] `args` 정규식은 합성 positive/negative fixture로 검증했는가?
- [ ] PII와 Secret을 메시지나 fixture에 그대로 넣지 않았는가?
- [ ] action과 severity가 영향에 맞는가?
- [ ] approval timeout이 fail-closed인가?
- [ ] 한국어/영어 설명과 예제를 함께 갱신했는가?
- [ ] validation과 benchmark가 통과하는가?
- [ ] `test:policy`용 케이스 파일(최소 1개 양성 케이스)을 추가했는가?

문서만으로 신규 정책 한 건을 작성할 수 있는지 검증하는 외부자 테스트 절차는 [작성자 테스트](author-test.md)에 있습니다.

## 12. SCR-302 빈 상태 문구

Policy 화면에 정책이 없을 때는 사용자를 이 문서로 안내합니다. 구현에 사용할 정확한 한국어/영어 문구와 링크는 [SCR-302 UX copy](../ux/scr-302-empty-state.md)를 사용하세요.
