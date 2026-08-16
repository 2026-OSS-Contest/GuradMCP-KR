# .env 유출 공격 데모 (T-01)

[English](env-leak-demo.en.md) | **한국어**

대표 데모입니다. 악성 README에 숨긴 주석이 Agent에게 `.env`를 읽어 외부로 보내라고 시키고, 게이트웨이가 **첫 단계에서** 멈춥니다(위협 T-01). 시연 0:20~1:30 구간에 해당합니다.

## 무엇을 비교하나

| | 미적용 | 적용 |
| --- | --- | --- |
| 호출 대상 | 도구 서버 직접 | 게이트웨이 경유 |
| 1단계 `read_file('.env')` | 성공 — 자격증명 반환 | **차단** (`block_env_file_read`) |
| 2단계 `send_email` | 실행됨 — 유출 성립 | **발생하지 않음** |
| 결과 | `leaked: true` | `blocked: true`, `leaked: false` |

**에이전트 코드는 양쪽이 동일합니다.** 계획도 같고 루프도 같습니다 — 바뀌는 것은 도구 호출이 향하는 엔드포인트 하나뿐입니다.

차단이 **1단계에서** 일어나는 게 핵심입니다. 유출은 두 단계짜리 체인인데, 첫 단계를 막으면 두 번째는 물어볼 일조차 없어집니다.

## 재현

```bash
docker compose --profile demo up -d
```

```bash
./scripts/demo-env-leak.sh
```

스크립트는 출력만 하지 않고 **검증**합니다.

- 적용 체인이 **1단계에서 끝났는지** (`send_email`이 아예 실행되지 않았는지)
- 차단이 `block_env_file_read`를 근거로 들었는지
- 적용 응답 어디에도 샌드박스 `.env`의 값(`sk-`, `ghp_`, `AKIA`, `SMTP_PASSWORD`)이 없는지
- **미적용이 실제로 유출하는지** — 이게 없으면 적용 쪽 결과가 아무것도 증명하지 못합니다

하나라도 어긋나면 무엇이 어긋났는지 이름을 대고 0이 아닌 코드로 끝납니다.

Agent 관점으로 직접 보려면:

```bash
curl --fail --silent --request POST "http://localhost:3002/demo/readme-summary?mode=guarded"
curl --fail --silent --request POST "http://localhost:3002/demo/readme-summary?mode=vulnerable"
curl --fail --silent --request POST http://localhost:3002/demo/readme-summary/compare
```

## 격리

도구 서버는 샌드박스입니다. `.env`는 **합성 값**이고 어디에도 인증되지 않으며, `send_email`은 실제 SMTP 대신 로컬 outbox에만 기록합니다. 미적용 모드가 "유출에 성공"해도 나가는 곳이 없습니다.

## 차단 이벤트에 무엇이 담기나

게이트웨이는 차단 판정을 GuardEvent로 발행하고, 감사 경로(`POST /api/v1/events`)로 Control Plane에 전달합니다. 실제 이벤트는 이렇습니다.

| 필드 | 값 |
| --- | --- |
| `verdict` | `block` |
| `matchedPolicyIds` | `["block_env_file_read"]` |
| `riskScore` | `38` |
| `explanation.ko` | 차단했습니다 — 정책 block_env_file_read (심각도 critical)… |
| `argsDigest` | 검사한 인자의 다이제스트 — **원문 아님** |
| `normalizedPath` | `.env` |

`normalizedPath`가 들어가는 건 의도된 것입니다(FR-SEC-04 §3.3) — **`path_regex`가 무엇에 매칭됐는지** 남기기 위한 필드이고, 파일 **내용**은 어디에도 담기지 않습니다. 다만 이 필드는 Control Plane 수집 DTO에 없어서 경계에서 버려집니다. Replay 타임라인까지는 도달하지 않습니다.

## Replay에서 확인하기

차단 이벤트는 위 표대로 정책 ID와 위험 점수를 싣고 Control Plane까지 도달하며, **Replay 화면이 그걸 읽습니다**(GMCP-114). 방금 실행한 데모가 세션 목록에 나타납니다.

```bash
curl --fail --silent "http://localhost:8080/api/v1/sessions?limit=100"
```

`agentLabel`이 이 데모의 게이트웨이 세션 ID인 항목을 찾아, 그 `sessionId`(UUID)로 타임라인을 엽니다.

```bash
curl --fail --silent "http://localhost:8080/api/v1/sessions/<uuid>/timeline"
```

차단 노드에 `verdict: "block"`, `riskScore`, `detail.matchedPolicyIds: ["block_env_file_read"]`가 위 표와 같은 값으로 담겨 있습니다. 자세한 동작은 [Replay 세션·타임라인](replay.md)에 있습니다.

조회 시점에 투영하므로 화면을 새로 불러야 새 이벤트가 보입니다 — 실시간 푸시는 아직 없습니다.
