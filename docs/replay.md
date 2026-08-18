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

세션의 VERDICT 노드들은 각자의 `hash`를 직전 판정의 `hash`에 묶습니다. `chainStatus`는 세 가지입니다.

| 값 | 의미 |
| --- | --- |
| `valid` | 저장된 해시와 재계산한 값이 일치 |
| `broken` | 불일치. `brokenAt`이 어긋난 첫 이벤트를 지목 |
| `unknown` | **대조할 저장된 해시가 없음 — 검증을 주장하지 않음** |

**투영된 세션은 이제 실제로 검증됩니다(GMCP-83).** `GuardEventRepository.insert`가 이벤트를 적재하는 시점에 세션별 락 아래에서 `seq`·`prev_hash`·`hash`를 함께 채워 저장하고, 조회 시 `GuardEventHasher.verify`가 저장된 해시를 `seq` 순서대로 다시 계산해 대조합니다. 비교 대상이 "저장된 값"과 "그 자리에서 새로 만든 값"이라, 행이 변조되면 실제로 `broken`이 뜹니다.

`unknown`은 이제 예외적인 경우에만 나옵니다 — 세션 안의 어떤 행이든 `seq`/`prev_hash`/`hash`가 비어 있으면(이 기능이 배포되기 전에 적재된 이벤트, 혹은 이벤트가 아예 없는 세션) 그 세션 전체가 `unknown`입니다. 그런 행은 기록 당시 함께 남긴 해시가 없어 검증 자체가 불가능하므로, `broken`으로 오탐하는 대신 `unknown`으로 남깁니다.

콘솔은 `unknown`일 때 체인 배지를 **아예 표시하지 않습니다**. 검증하지 않은 세션에 녹색 "검증됨"을 붙이는 것은 아무것도 안 보여주는 것보다 나쁘기 때문이고, 이건 `replay-adapter.ts`가 딥링크 조회에 이미 적용하던 규칙입니다.

시드 세션은 `valid`·`broken`이 나옵니다. 기동 시 해시를 만들어 노드에 담아두고, 그중 하나를 **일부러 틀리게** 저장해 둔 픽스처가 있어서 불일치가 실제로 검출됩니다. 시드와 실제 적재 이벤트는 **서로 다른 코드**로 검증합니다 — 시드는 `ReplayChain`이 이 해시 체인이 생기기 전부터 있던 `TimelineNode` 형태를 그대로 해시하는 반면, 적재된 이벤트는 `GuardEventHasher`가 Postgres에 저장된 `GuardEventRecord`를 해시합니다. 그래서 `GuardEventHasher`로 시드를 검증하면 형태가 달라 오히려 `broken`이 나옵니다.

해시에 들어가는 필드는 `argsDigest`·`detections`(`type`/`subtype`/`confidence`만, `span`·`maskedAs`는 제외)·`direction`·`eventId`·`matchedPolicyIds`·`riskScore`·`seq`·`sessionId`·`toolName`·`ts`·`verdict`뿐입니다. **`rawPayload`와 `maskDiffRef`는 해시에서 빠집니다** — NFR-04 옵트인으로 원문을 저장하거나 나중에 마스킹 형식이 바뀌어도, 그것만으로는 체인이 깨지지 않도록 하기 위해서입니다.

세션별 `seq`/`hash` 할당은 세션 단위 락(in-JVM `synchronized`)으로 원자성을 보장합니다. 이 락은 **단일 인스턴스 안에서만** 유효합니다 — control-plane을 여러 인스턴스로 수평 확장하면 별도의 분산 락이 필요하며, 데모 범위에서는 다루지 않습니다.

세부 검증 결과(검증한 이벤트 수·전체 이벤트 수·불일치 이벤트 id 목록·마지막으로 검증된 해시)는 `GET /sessions/{id}/chain-verify`로 따로 조회할 수 있습니다. 타임라인 응답의 `chainStatus`/`brokenAt`은 그 요약입니다.

## 남은 것

- **실시간 갱신은 없습니다.** 조회 시점에 투영하므로, 화면을 새로 불러야 새 이벤트가 보입니다. SSE 스트림은 별건입니다.
- 투영은 요청마다 계산합니다. 데모 규모에서는 문제없지만, 이벤트가 많아지면 캐시가 필요합니다.
- 감사 기록은 완결된 이력이라 `status=live` 필터에는 잡히지 않습니다. 시드 세션 중 `isLive: true`인 것만 나옵니다.
