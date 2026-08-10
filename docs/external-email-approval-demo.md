# 데모: 외부 이메일 전송 차단과 승인 시퀀스

[English](external-email-approval-demo.en.md) | **한국어**

에이전트가 API 키 같은 Secret이 포함된 본문을 외부 도메인으로 `send_email`하려 하면, 즉시 차단하는 대신 사람의 승인을 기다린다(`require_approval`). 운영자가 "마스킹 후 승인"을 선택하면 **마스킹된 본문만** 실제로 전송되고, 120초 동안 아무도 응답하지 않으면 자동으로 차단된다(fail-closed). 이 데모는 두 경로를 모두 실제 Gateway·Control Plane을 통해 보여준다.

## 무엇을 비교하나

| | 마스킹 후 승인 (기본) | 무응답 (`--timeout`) |
| --- | --- | --- |
| 운영자 조치 | Control Plane에 `approve_masked` 전송 | 없음 (120초 대기) |
| 판정 | `require_approval` → `mask_then_allow` | `require_approval` → `block` (`APPROVAL_TIMEOUT_BLOCKED`) |
| Outbox(가짜 SMTP) | `to`는 그대로, `body`만 `[SECRET]`으로 치환되어 기록됨 | 아무것도 기록되지 않음 |
| Agent에 반환되는 응답 | 오류 없음 | 표준 `GuardBlockError` (원문 민감정보 없음) |

## 재현

Gateway와 Control Plane은 프로파일과 무관하게 항상 뜨는 서비스이고, `demo-mcp-tools`(가짜 SMTP)는 `demo` 프로파일에 포함된다.

```bash
docker compose --profile demo up -d
```

```bash
./scripts/demo-external-email-block.sh            # 마스킹 후 승인 경로
./scripts/demo-external-email-block.sh --timeout   # 120초 무응답 자동 차단 경로 (실제로 120초 대기)
```

`demo-korean-pii.sh`와 마찬가지로 결과를 출력만 하지 않고 **검증**한다. 마스킹 후 승인 경로에서는 Outbox에 실제로 기록된 메시지의 수신자가 그대로인지, 본문에서 원문 Secret이 사라지고 `[SECRET]`으로 바뀌었는지 확인한다. 타임아웃 경로에서는 `reasonCode`가 `APPROVAL_TIMEOUT_BLOCKED`인지, Outbox에 아무것도 추가되지 않았는지 확인한다. 하나라도 어긋나면 0이 아닌 코드로 끝난다. 두 경로 모두 실제 `docker compose` 스택(Gateway·Control Plane·demo-mcp-tools)을 대상으로 실행해 통과를 확인했다 — 타임아웃 경로는 실제로 120초를 기다린다.

스크립트는 Gateway의 `/mcp` 응답이 승인 결과가 나올 때까지 열려 있다는 점(§5.1) 때문에 Agent 역할의 요청을 백그라운드로 실행하고, 그동안 Control Plane API로 운영자 역할(또는 무응답)을 수행한다 — 콘솔이 실제로 누르는 것과 같은 `POST /api/v1/approvals/{id}/decision` 호출이다.

## 적용 정책

`policy-packs/default/policies/require-approval-external-secret-email.yaml` (`id: approve_external_email_with_secret`). `to_not_domain: [company.co.kr]` 외부 수신자 + `SECRET`/`PII.RRN_LIKE` 탐지 + `risk_score >= 70` 조합에서 `require_approval`로 전환되며, `approval.timeout_seconds: 120`, `on_timeout: block`, `allow_masked_approval: true`를 선언한다.

## 구현 개요

- **Gateway**(`packages/gateway/src`): `server.ts`의 `tools/call` 처리에서, 도구가 `send_email`이고 `body`가 문자열이면 탐지·마스킹 대상 텍스트(`emailBody`)를 본문으로만 한정한다 — `to` 주소는 PII 탐지기가 `PII.EMAIL`로 잡아내는 값이라, 인자 전체 JSON을 검사·마스킹 대상으로 삼으면 마스킹 후 승인 시 수신자 주소 자체가 `[EMAIL]`로 깨진다(이 문제는 실제로 재현해 확인했다). 마스킹된 결과는 원래의 `to`/`subject`와 다시 합쳐서 upstream으로 보낸다. `CONTROL_PLANE_URL`이 설정되면 `server.ts`가 `controlPlane/approvalBackend.ts`를 승인 백엔드로 선택한다 — 실제 Control Plane에 승인을 등록하고(`POST /api/v1/approvals`) 폴링으로 결정을 기다리며(§10: "SSE 또는 polling" 중 polling 경로), Control Plane에 도달할 수 없거나 응답이 없으면 로컬 데드라인으로 fail-closed된다. `CONTROL_PLANE_URL`이 없으면 기존의 즉시-만료 백엔드(`approval/backend.ts`)로 fail-closed 동작을 유지한다. 승인 카드에 필요한 위험 태그·마스킹 미리보기는 `pipeline/approvalPreview.ts`가 대기 중인 요청 자체에서 계산해 `actionRouter.ts`의 `awaitApproval()`이 함께 전송한다(원문은 아직 아무 데도 전송되지 않은 상태이므로 이 시점엔 정당하게 보관 가능 — NFR-04, 마스킹 미리보기는 정책이 `allow_masked_approval`을 허용할 때만 보낸다). 승인 카드의 `arguments`에는 `body`를 다시 넣지 않는다 — `body`는 이미 `maskPreview`가 (수명이 있는 채로) 담고 있어서, 같은 원문을 `arguments`로도 보내면 아무도 지우지 않는 사본이 하나 더 생긴다. `to`/`subject`만 카드에 넘기고, send_email이 아닌 다른 도구는 애초에 `arguments`를 보내지 않는다. GuardEvent를 Control Plane 감사 로그(`POST /api/v1/events`)로 전달하는 것은 이 티켓 이전부터 있던 `pipeline/auditPublisher.ts`(GMCP-24)가 이미 하고 있어 새로 만들지 않았다.
- **Control Plane**(`services/control-plane`): `ApprovalController`의 `POST /api/v1/approvals`는 더 이상 세션이 미리 등록돼 있을 것을 요구하지 않는다 — 원래 코드는 `sessionId`를 `UUID`로 받아 데모 시드 데이터(`GuardEventStore`)에 존재하는지 확인했는데, Gateway가 실제로 보내는 세션 id(예: `req-1`, 또는 이 데모 스크립트의 `demo-external-email-<timestamp>-<pid>`)는 UUID가 아니어서 이 확인을 통과할 수 없었다. `sessionId`를 문자열로 바꾸고 사전 등록 확인 자체를 없앴다. `ApprovalStore`는 이제 `riskTags`/`threatScore`/`maskPreview`를 `PENDING` 동안 보관하고(불투명하게, 해석하지 않고 그대로 저장), `decide()`와 새로 추가한 `sweepExpired()` 양쪽에서 `maskPreview`(원문 포함)를 지운다(NFR-04) — 승인 대기 창을 벗어나서는 원문이 남지 않는다. 카드가 담는 `arguments`(`to`/`subject`)는 위 Gateway 쪽 설계 덕분에 애초에 원문 Secret을 포함하지 않으므로 별도로 지울 필요가 없다. `sweepExpired()`는 기한이 지난 `PENDING` 건을 `EXPIRED`로 넘기고 `decidedBy: "system:timeout"`을 남긴다; 1초 간격 스케줄러(`ApprovalTimeoutScheduler`, `@EnableScheduling` 필요해서 함께 추가)와 `list()`/`get()`/`decide()` 호출 시점 모두에서 스윕이 일어난다. 사람이 내린 결정의 `decidedBy`는 그대로 감사 이벤트까지 전달된다.
- **demo-agent**(`apps/demo-agent`): `require_approval`이 이제 실제로 최대 120초까지 응답을 붙들 수 있게 되면서(이전에는 항상 즉시 만료됐다), `GatewayToolInvoker`가 Gateway에 거는 HTTP 타임아웃을 5초에서 130초로 늘렸다. T-01(악성 README) 시나리오는 `read_file(".env")` 단계에서 이미 차단되어 이 경로를 타지 않고, 상담 이력 데모도 `mask_then_allow`만 거쳐 가므로 두 데모 모두 이번 변경으로 인한 실제 회귀는 없음을 직접 실행해 확인했다 — 그래도 앞으로 `send_email` 경로가 실제로 `require_approval`까지 도달하는 시나리오가 추가될 것에 대비해 고쳐 두었다.

## 한계

- **Redis 대기열은 쓰지 않는다.** 기획서 §5.1은 "Redis 대기열"을 언급하지만, 완료 기준(§9)은 승인 요청이 durable하게 대기하고 폴링/SSE로 응답을 받을 수 있으면 충족된다. Control Plane의 `ApprovalStore`가 그 저장소 역할을 하며, Gateway는 그 위에 폴링으로 붙는다.
- **Replay(SCR-301) 화면은 이 데모의 실데이터로 연동되지 않는다.** 콘솔의 `TimelineResponse`/`EventDetail` 계약은 `user`/`agent`/`tool_call`/`verdict`/`result` 노드로 이뤄진 서사형 모델인데, 이를 채우는 `ReplayStore`(GMCP-28)는 하드코딩된 시드 세션만 갖고 있고 Gateway가 실제로 내보내는 GuardEvent를 받아들이는 인입 경로가 없다 — `AuditEventController`(`POST /api/v1/events`, GMCP-24)가 실제로 이벤트를 저장하는 `GuardEventRepository`와 `ReplayStore`는 서로 다른, 연결되지 않은 저장소다. 이 간극을 메우는 것은 Control Plane API 작업(GMCP-80)의 몫이며 — `docs/korean-pii-demo.md`가 Detector Console 연동에 대해 남긴 것과 같은 성격의 한계다. **해시 체인도 같은 이유로 이 데모의 승인 이벤트를 검증하지 못한다**: `AuditChain`은 트러스트-등급 변경 이벤트에만 연결돼 있고(`GuardEvent`는 아직 대상이 아니다), `GuardEventRepository`(실제 이벤트가 쌓이는 곳)에는 해시 체인 필드 자체가 없다. `ReplayStore`가 `GET /sessions/{id}/timeline`에서 돌려주는 체인 상태(`chain.status`)는 실재하지만, 그건 시드 데이터 자체의 체인일 뿐 이 데모가 만든 실제 승인 이벤트를 반영하지 않는다 — 즉 완료 기준(§9)의 "해시 체인이 검증됨"은 §5 시연 과정에서 관찰할 수 있는 항목이 아니다.
- **콘솔이 실제 Control Plane을 직접 렌더링하는 것은 별도 인프라 문제로 막혀 있다.** 승인 카드가 필요로 하는 `riskTags`/`threatScore`/`maskPreview`는 이제 Control Plane이 실제로 저장·반환한다 — 이번 세션에서 `docker compose` 스택을 띄우고 `curl`로 승인 생성 전/후를 직접 확인했다(결정 전엔 `riskTags`/`maskPreview`가 채워지고, 결정 후엔 `maskPreview`가 `null`로 지워진다). 하지만 브라우저에서 콘솔을 Control Plane에 직접 붙여 보면 (a) Control Plane이 CORS 헤더를 보내지 않아 크로스 오리진 fetch가 막히고, (b) `GET /overview`가 콘솔의 `Overview` 계약과 다른 모양을 반환해 공용 레이아웃(StatusBar)이 그 자체로 죽는다 — 둘 다 이 티켓 이전부터 있던, 승인 화면에 국한되지 않는 문제이며 GMCP-80 소관이다.
