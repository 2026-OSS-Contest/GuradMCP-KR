# 난독화 전처리 (Obfuscation preprocessing)

[English](obfuscation.en.md) | **한국어**

은닉 지시문은 평문으로만 오지 않습니다. 같은 문장을 인코딩하거나 보이지 않는 문자로 끊어 놓으면 패턴 매칭만으로는 통과합니다(위협 T-07). 탐지기는 검사 전에 이런 변형을 되돌립니다.

## 적용되는 전처리

| 변형 | 처리 | 구현 |
| --- | --- | --- |
| 유니코드 호환 문자 (예: `ﬁ`) | NFKC 정규화 | `normalizeInput` |
| zero-width 문자 (U+200B~U+200D, U+FEFF) | 제거 | `normalizeInput` |
| Base64 인코딩 블록 | 디코딩 후 인젝션 규칙 재검사 | `findEncodedInjections` |

정규화는 **원문 오프셋 매핑을 유지**하므로, 변형된 문자열에서 찾은 탐지도 원문의 정확한 위치에 마스킹됩니다.

## Base64 디코딩

인코딩된 구간을 디코딩해 인젝션 규칙으로 다시 검사합니다. 규칙에 걸리면 **인코딩된 구간 전체**를 하나의 탐지로 보고합니다.

```text
입력    참고 자료: SWdub3JlIGFsbCBwcmV2aW91cyBpbnN0cnVjdGlvbnMg...
탐지    INJECTION.OBFUSCATED
마스킹  참고 자료: [INJECTION]
```

- **span은 인코딩된 구간을 가리킵니다.** 마스킹이 블롭 전체를 치환하므로 디코딩된 지시문은 호출자에게도, 이벤트에도 남지 않습니다(NFR-04).
- **subtype은 `OBFUSCATED`입니다.** 기본 정책팩의 `block_untrusted_injection_response`가 이미 `INJECTION.OBFUSCATED`를 매칭 축에 두고 있어, 새 축을 만들지 않고 기존 정책을 실제로 동작하게 합니다.
- **오탐 방지**: `atob`이 잘못된 base64를, fatal `TextDecoder`가 UTF-8이 아닌 바이트열을 각각 거부합니다. 해시·바이너리·이미지 데이터는 여기서 걸러지고, 디코딩에 성공해도 **인젝션 규칙에 걸릴 때만** 보고합니다. 평범한 JSON이나 문장을 인코딩한 값은 탐지되지 않습니다.

### 경계값

| 항목 | 값 | 이유 |
| --- | --- | --- |
| 최소 후보 길이 | 24자 | 짧은 토큰이 우연히 base64로 보이는 경우 제외 |
| 최대 후보 길이 | 4,096자 | 거대한 블록 디코딩으로 지연이 늘지 않게 상한 |
| 페이로드당 최대 디코딩 수 | 16개 | 은닉 지시문은 짧다는 전제의 비용 상한 |

## 지연 영향 (NFR-01)

10KB 페이로드 300회 반복 측정, 예산은 p95 ≤ 50ms입니다.

| 페이로드 | 전처리 전 p95 | 전처리 후 p95 | 차이 |
| --- | --- | --- | --- |
| 벤치마크 기본(10KB, base64 없음) | 0.131ms | 0.131ms | 측정 오차 내 |
| base64 블록 포함(10KB) | 0.162ms | 0.314ms | **+0.15ms** |

base64가 포함된 최악 조건에서도 예산의 **약 0.6%**를 사용합니다. base64가 없는 페이로드는 후보 자체가 없어 비용이 발생하지 않습니다.

구현은 [`packages/gateway/src/detect.ts`](../packages/gateway/src/detect.ts), 공격 샘플은 [`attack-lab/scenarios/threats.json`](../attack-lab/scenarios/threats.json)의 `T-07-b`(인코딩된 공격)와 `T-07-c`(정상 base64 대조)에 있습니다.
