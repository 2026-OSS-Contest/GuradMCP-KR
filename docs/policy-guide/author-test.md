# 외부 정책 작성자 테스트

[English](author-test.en.md) | **한국어**

목표는 GuardMCP-KR 구현을 모르는 외부 기여자가 [정책 작성 가이드](README.md)만 보고 유효한 새 정책 한 건과 회귀 fixture를 만들 수 있는지 확인하는 것입니다.

## 참가자 조건

- 프로젝트 코드 또는 정책 엔진 구현을 보지 않은 사람 1명 이상
- YAML 기본 문법은 알지만 Appendix A 설명을 미리 받지 않음
- 진행자는 정답이나 명령을 구두로 설명하지 않음

## 과제

> `untrusted` MCP 서버의 `fetch_url` 응답에서 `INJECTION.OBFUSCATED`가 탐지되고 위험 점수가 80 이상이면 `block`하는 high severity 정책을 새 팩에 작성하세요. 공격 fixture 한 건과 정상 fixture 한 건을 추가하고 validation/benchmark를 실행하세요. 실제 비밀값이나 개인정보는 쓰지 마세요.

## 관찰 항목

| 항목 | 기록 |
| --- | --- |
| 시작/종료 시각 |  |
| 가이드 외 도움 요청 |  |
| 잘못 이해한 필드/규칙 |  |
| validation 첫 결과 |  |
| benchmark 최종 결과 |  |
| 문서 개선 제안 |  |

## 합격 기준

1. 30분 안에 완성한다.
2. 정책의 `direction`, `tool`, `server_trust`, `detections`, `risk_score`, action/severity가 과제와 일치한다.
3. `npm run policy:validate`가 통과한다.
4. `npm run bench`가 기존 품질 기준을 유지한다.
5. 공격 fixture는 매칭하고 정상 fixture는 매칭하지 않는다.
6. 실제 개인정보/비밀값이 없고, 진행자의 구두 힌트가 없었다.

## 증거 보관

완료한 commit/PR, 익명화된 관찰표, validation 출력과 benchmark JSON을 Issue에 첨부합니다. 외부자 테스트를 실행하기 전에는 성공했다고 표시하지 않습니다. 실패는 문서 결함으로 기록하고 가이드를 고친 뒤 새 참가자로 다시 실행합니다.
