## 무엇을 바꾸나요? / What changes?

<!-- 목적과 사용자 영향을 간단히 설명하세요. Describe the purpose and user impact. -->

Closes #

## 변경 유형 / Change type

- [ ] 코드 / Code
- [ ] 정책 규칙·정책팩 / Policy rule or pack
- [ ] PII 패턴·탐지 데이터 / PII pattern or detection data
- [ ] 공격·정상 샘플 / Attack or benign sample
- [ ] 문서·번역 / Documentation or translation

## 검증 / Validation

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] 관련 unit/JUnit/Kotest/Playwright 테스트 / Relevant tests
- [ ] `npm run policy:validate` (정책 변경 / policy change)
- [ ] `npm run bench` (정책팩·데이터셋 변경 / policy-pack or dataset change)

실행 결과 요약 / Result summary:

```text

```

## 정책팩 벤치마크 / Policy-pack benchmark

<!-- 정책팩/데이터셋 PR이면 recall, FPR, p95와 baseline diff를 붙이세요. Attach recall, FPR, p95, and baseline diff. -->

- Recall:
- FPR:
- p95 (10KB):
- 의도된 verdict 변화 / Intended verdict changes:

## 안전·문서 확인 / Safety and documentation

- [ ] 실제 개인정보·유효한 비밀값이 없습니다. / No real personal data or live secrets.
- [ ] 합성 fixture의 기대 결과를 명시했습니다. / Synthetic fixtures have expected results.
- [ ] 사용자 개념 변경을 한국어·영어 문서에 함께 반영했습니다. / User-facing concepts are updated in Korean and English.
- [ ] 관련 정책 가이드 또는 changelog를 갱신했습니다. / Relevant policy guide or changelog is updated.

## 리뷰어 참고사항 / Reviewer notes

<!-- 위험, 의도적 비호환, 후속 작업을 적으세요. Note risks, intended incompatibilities, and follow-ups. -->
