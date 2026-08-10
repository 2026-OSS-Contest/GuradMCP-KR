# 국내 서비스 자격증명 탐지 (Korean service credentials)

[English](korean-service-tokens.en.md) | **한국어**

GitHub 토큰이나 AWS 키를 잡는 도구는 많습니다. 그 도구들이 공통으로 놓치는 것이 **국내 서비스의 자격증명**입니다 — 토스페이먼츠 시크릿 키가 상담 로그에 섞여 나가도 해외 스캐너는 아무 말도 하지 않습니다. 이 카탈로그는 그 빈칸을 채웁니다(FR-SEC-02).

탐지되면 전부 `[KR_SERVICE_TOKEN]` 하나로 마스킹됩니다.

## 카탈로그

원천은 [`packages/gateway/src/rules/korean-service-tokens.json`](../packages/gateway/src/rules/korean-service-tokens.json)입니다.

| ID | 서비스 | 자격증명 | 방식 | 신뢰도 |
| --- | --- | --- | --- | --- |
| `TOSS_SECRET_KEY` | 토스페이먼츠 | 시크릿 키 | 시그니처 | 0.95 |
| `TOSS_CLIENT_KEY` | 토스페이먼츠 | 클라이언트 키 | 시그니처 | 0.85 |
| `KAKAO_ADMIN_HEADER` | 카카오 | REST API 키 (Authorization 헤더) | 시그니처 | 0.95 |
| `KAKAO_APP_KEY` | 카카오 | 앱 키 (REST·JavaScript·Admin) | 문맥 | 0.85 |
| `NCP_ACCESS_KEY` | 네이버 클라우드 플랫폼 | 서브 계정 액세스 키 | 시그니처 | 0.9 |
| `NAVER_CLIENT_SECRET` | 네이버 개발자센터 | 클라이언트 시크릿 | 문맥 | 0.9 |
| `BROKERAGE_APP_SECRET` | 국내 증권사 Open API | 앱 시크릿 | 문맥 | 0.8 |

## 시그니처와 문맥의 차이

**시그니처**는 자격증명 자체의 모양만으로 알아봅니다. `test_sk_`·`live_sk_`·`ncp_iam_` 같은 접두사는 그 서비스만 쓰기 때문에 주변 문장이 없어도 확실합니다.

**문맥**은 값 옆에 키워드가 있어야 합니다. 값 자체가 평범한 식별자와 구분되지 않기 때문입니다. 카카오 앱 키는 소문자 16진수 32자인데, **이건 MD5 해시와 똑같이 생겼습니다.** 값만 보고 잡으면 로그에 찍히는 체크섬을 전부 자격증명으로 신고하게 됩니다. 그래서 이 항목은 `kakao_rest_api_key = …` 형태의 대입을 요구하고, 헤더 형태는 별도의 시그니처 항목이 담당합니다.

신뢰도가 낮은 항목일수록 문맥 의존이 크고, 그만큼 형태를 바꾼 유출은 놓칠 수 있습니다. `BROKERAGE_APP_SECRET`이 이 파일에서 가장 약한 항목입니다 — 국내 증권사 Open API의 앱 키·시크릿에는 벤더 접두사가 없어서 필드 이름에 기댈 수밖에 없습니다. 여기가 가장 먼저 고쳐져야 할 곳입니다.

## 서비스 추가하기

**TypeScript를 고칠 필요가 없습니다.** JSON에 항목 하나를 추가하면 됩니다.

```json
{
  "id": "MY_SERVICE_API_KEY",
  "service": "서비스 이름 / Service name",
  "credential": "자격증명 종류",
  "match": "signature",
  "pattern": "\\bmysvc_[A-Za-z0-9]{24,}\\b",
  "flags": "g",
  "confidence": 0.9,
  "basis": "이 패턴이 왜 이 모양인지, 어디서 확인했는지"
}
```

`basis`는 형식이 아니라 **근거**입니다. 검증된 벤더 형식인지 추측인지 구분할 수 없으면 다음 사람이 이 항목을 고칠 수 없기 때문에 필수 항목이고, 비어 있으면 게이트웨이가 기동하지 않습니다.

그다음 [`attack-lab/datasets/korean-service-tokens.json`](../attack-lab/datasets/korean-service-tokens.json)에 샘플을 넣습니다. **양성 샘플은 `credential`에 방금 만든 `id`를 적어야 하고**, 음성 샘플도 함께 넣습니다.

```json
{"id": "kst-15", "label": true, "credential": "MY_SERVICE_API_KEY", "text": "설정에 mysvc_ABCdef0123456789ABCdef01 를 넣었습니다."},
{"id": "kst-n11", "label": false, "text": "mysvc 문서에서 인증 방식을 확인했습니다."}
```

값은 반드시 **합성**이어야 합니다. 실제로 발급받은 키는 형태만 같아도 넣지 마세요.

```bash
npm run test:unit && npm run bench
```

## 측정

`npm run bench`가 이 데이터셋으로 재현율과 오탐률을 재고, 리포트의 `koreanServiceTokens`에 기록합니다. **PII 재현율과 분리해서 잽니다** — 한쪽에 섞으면 PII 점수가 좋을 때 국내 자격증명 탐지가 망가진 걸 가릴 수 있고, 그건 이 파일의 존재 이유를 정확히 뒤집는 일입니다.

| 지표 | 기준 |
| --- | --- |
| `koreanServiceTokenRecall` | ≥ 0.90 |
| `koreanServiceTokenFpr` | ≤ 0.05 |

양성 샘플은 **자기가 지목한 항목**에 걸려야 합니다. 다른 규칙에 우연히 걸린 건 통과로 세지 않기 때문에, 항목 이름을 바꾸고 데이터셋을 안 고치면 여기서 실패합니다.

## 한계

- 접두사 없는 자격증명은 필드 이름 없이 나가면 놓칩니다. 문맥 항목의 구조적 한계입니다.
- 토큰이 base64로 한 번 더 감싸여 있으면 잡지 못합니다. 난독화 해제 패스는 인젝션 규칙만 재검사합니다([난독화 전처리](obfuscation.md)).
- 증권사 항목은 한 벤더의 필드 이름 관행에 기대고 있어, 다른 증권사에서는 형태가 다를 수 있습니다.
