# 기능 동결 준비 상태 (GMCP-43)

실행 런북: [feature-freeze.md](feature-freeze.md) · 동결 예정일 **2026-08-20 (W7)**

## 2026-08-11 사전 정리 (김규호)

### 이미 준비된 것

- 동결 원칙·Must/Should 판정 절차·당일 체크리스트 문서 (`feature-freeze.md`) 머지 완료
- 제출 패키징 체크리스트 (`submission-checklist.md`) 및 `scripts/package-submission.sh`
- 중간·최종 보고서 골격, 벤치마크 결과 문서

### 동결 당일(8/20)에 할 일 (런북 요약)

1. 열린 feature PR 전부 병합 또는 close
2. Must 완료 확인; 미완료 Should 동결/이월 합의 → Plane 코멘트 표
3. `feat` 신규 브랜치 생성 금지 공지
4. 회귀: `npm run check` + compose demo 스모크

### 현재 open PR (참고, 시점 변동)

동결 전 잔여 feature는 작성자 리베이스 후 머지하거나 동결 시 close 대상입니다. 최신 목록은 GitHub `dev` base open PR을 확인합니다.

### 판정

- **문서·절차 준비: 완료**
- **동결 선언 자체: 2026-08-20 당일 실행** (이 티켓은 당일 체크리스트 수행 후 Done)
