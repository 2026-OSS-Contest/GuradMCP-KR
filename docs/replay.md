# Replay 세션·타임라인

[English](replay.en.md) | **한국어**

Replay 화면은 **판정이 왜 그렇게 났는지**를 되짚는 곳입니다. 어떤 도구 호출이 어떤 정책에 걸려 어떤 위험 점수로 끝났는지를 시간순으로 보여 줍니다(GMCP-28).

## 데이터가 어디서 오나

두 곳입니다.

| 출처 | 내용 | 왜 있나 |
| --- | --- | --- |
| **수집된 감사 이벤트** | 게이트웨이가 실제로 발행한 판정 | 실행한 데모가 화면에 나타나야 하니까 |
| **시드 세션 4건** | 기동 시 만들어지는 데모 픽스처 | 실행으로는 만들 수 없는 것들이 있어서 |

```text
게이트웨이 판정 → POST /api/v1/events → guard_event(Postgres)
                                            │
                                            ├─ 세션·타임라인으로 투영
시드 세션 4건 ─────────────────────────────┤
                                            ▼
                            GET /sessions · /sessions/{id}/timeline · /events/{id}
```

**시드를 남긴 이유**는 두 건이 실행으로 재현이 안 되기 때문입니다. 해시 체인이 깨진 세션은 **위조가 탐지되는 장면**을 보여주려고 일부러 손상시킨 것이고, 1200노드 세션은 **페이지네이션을 실제로 넘겨보려고** 만든 것입니다. 아무것도 실행하지 않은 첫 기동에서 화면이 비어 있지 않게 하는 역할도 합니다.

## 이벤트 하나가 노드 하나입니다

게이트웨이는 라우팅 결과마다 GuardEvent를 **한 건** 발행합니다. 그래서 투영도 **VERDICT 노드 하나**를 만들고, 그 노드가 판정 대상이었던 도구 이름·방향·인자 다이제스트를 함께 답니다.

TOOL_CALL 노드를 따로 만들지 않습니다. 만들면 **발행된 적 없는 이벤트를 타임라인에 올리는 것**이 되고, 그건 감사 기록이 하면 안 되는 일입니다.

노드의 `eventId`는 게이트웨이가 보낸 값 그대로입니다. 덕분에 감사 레코드의 ID로 `GET /events/{id}`가 바로 열립니다.

## 판정 어휘 변환

정책 엔진은 다섯 가지를 냅니다. Replay 배지는 네 개뿐입니다.

| 정책 엔진 | Replay |
| --- | --- |
| `block` | `block` |
| `require_approval` | `require_approval` |
| `warn` | `warn` |
| **`mask_then_allow`** | **`warn`** |
| `allow` | `allow` |

`mask_then_allow`를 `warn`으로 접는 건 콘솔이 이미 문서화한 규칙입니다. 읽는 사람이 알아야 할 것은 **호출이 변경됐다는 사실**이고, Replay에 그걸 따로 말할 다섯 번째 배지가 없습니다.

## 세션 ID

게이트웨이의 세션 ID는 불투명한 문자열(`req-s-envdemo`, `attacklab-1a2b`)이지만, Replay는 콘솔 URL까지 **UUID**로 세션을 지목합니다. 그래서 문자열에서 **이름 기반 UUID를 유도**합니다.

매핑 테이블이 필요 없고 재시작해도 같은 값이 나오므로, 세션으로 들어가는 딥링크가 계속 유효합니다. 목록의 `agentLabel`에는 원래 문자열이 그대로 보입니다.

## 실행한 데모를 Replay에서 보기

```bash
docker compose --profile demo up -d
./scripts/demo-env-leak.sh
```

그다음 세션 목록을 보면 방금 실행한 세션이 있습니다.

```bash
curl --fail --silent "http://localhost:8080/api/v1/sessions?limit=100"
```

`agentLabel`이 게이트웨이 세션 ID인 항목을 찾아 `sessionId`(UUID)로 타임라인을 엽니다.

```bash
curl --fail --silent "http://localhost:8080/api/v1/sessions/<uuid>/timeline"
```

차단 노드에 `verdict: "block"`, `riskScore`, `detail.matchedPolicyIds: ["block_env_file_read"]`가 함께 담겨 있습니다.

## 담기지 않는 것

검사한 원문은 어디에도 담기지 않습니다(NFR-04). 노드가 싣는 것은 `argsDigest` — 다이제스트뿐입니다.

게이트웨이는 자체 GuardEvent에 `normalizedPath`(어떤 경로가 `path_regex`에 걸렸는지)를 실을 때가 있지만, **수집 DTO에 그 필드가 없어서 경계에서 버려집니다.** Replay 타임라인에는 도달하지 않습니다.

## 해시 체인

세션의 VERDICT 노드들은 각자의 `hash`를 직전 판정의 `hash`에 묶습니다. 조회 시 체인을 **다시 계산해서** 저장된 값과 비교하므로, 중간에 한 건이 바뀌면 `chainStatus: "broken"`과 `brokenAt`이 나옵니다.

계산 알고리즘은 시드와 투영이 **같은 코드**(`ReplayChain`)를 씁니다. 복제해 두면 두 쪽이 어긋나고, 그때 첫 증상은 **문제 없는 체인을 BROKEN으로 신고하는 것**입니다.

## 남은 것

- **실시간 갱신은 없습니다.** 조회 시점에 투영하므로, 화면을 새로 불러야 새 이벤트가 보입니다. SSE 스트림은 별건입니다.
- 투영은 요청마다 계산합니다. 데모 규모에서는 문제없지만, 이벤트가 많아지면 캐시가 필요합니다.
- 감사 기록은 완결된 이력이라 `status=live` 필터에는 잡히지 않습니다. 시드 세션 중 `isLive: true`인 것만 나옵니다.
