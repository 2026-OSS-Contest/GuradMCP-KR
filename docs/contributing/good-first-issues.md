# good first issue 카탈로그

[English](good-first-issues.en.md) | **한국어**

아래 다섯 이슈는 코드 없이 30–90분 안에 완료할 수 있도록 설계한 등록용 초안입니다. 등록할 때 `good first issue`, `contributions welcome`과 영역 라벨을 붙이고 담당 maintainer를 정합니다.

## 1. `.npmrc` 자격증명 파일 정책 추가

- **라벨:** `good first issue`, `policy`
- **파일:** `policy-packs/default/policies/block-env-file-read.yaml` 또는 별도 YAML, 합성 fixture
- **작업:** `read_file`이 사용자 홈의 `.npmrc`를 요청할 때 차단하되 `docs/example.npmrc` 같은 문서 경로는 오탐하지 않도록 정책/fixture를 추가
- **금지:** 실제 npm token 사용, application TypeScript 수정
- **완료:** positive 1건 + benign negative 2건, validation/benchmark 통과, 양언어 설명

## 2. 사업자등록번호 검증 샘플 추가

- **라벨:** `good first issue`, `pii`, `dataset`
- **파일:** `attack-lab/datasets/`의 PII benchmark 데이터
- **작업:** 합성 `PII.BIZ_NO` positive와 형식은 비슷하지만 검증식이 틀린 negative를 각각 3건 이상 추가
- **금지:** 실제 사업자 식별정보 복사, detector 코드 변경
- **완료:** 기대 label/마스킹 tag 문서화, recall/FPR 기준 통과

## 3. 한국 전화번호 오탐 회귀 샘플 추가

- **라벨:** `good first issue`, `pii`, `false-positive`
- **파일:** `attack-lab/datasets/`의 benign 데이터
- **작업:** 날짜, 주문번호, 버전 번호 중 전화번호와 닮은 합성 negative 5건과 올바른 synthetic phone positive 2건 추가
- **금지:** 실제 전화번호, threshold 하향
- **완료:** FPR ≤ 5%, recall ≥ 90%, sample 목적 주석/문서

## 4. zero-width 한국어 인젝션 공격 샘플 추가

- **라벨:** `good first issue`, `attack-lab`, `prompt-injection`
- **파일:** `attack-lab/scenarios/` 또는 dataset
- **작업:** "이전 지시를 무시" 문장에 zero-width 문자를 넣은 합성 T-07 공격 1건과 정상 한국어 문장 1건 추가
- **금지:** 실제 외부 수신자/비밀값, 실행 가능한 파괴 명령
- **완료:** 기대 threat ID/verdict 명시, 공격 차단율 기준 통과, 사람이 읽을 수 있는 de-obfuscated 설명

## 5. `korean-pii` 새 정책 예제 한/영 해설

- **라벨:** `good first issue`, `documentation`, `policy`
- **파일:** `policy-packs/korean-pii/README.md`, `docs/policy-guide/README.md`, `README.en.md`
- **작업:** 기존 정책 하나의 각 match 축과 action 선택을 한국어/영어로 같은 의미가 되게 주석 또는 표로 설명
- **금지:** 정책 동작 변경, 한 언어만 수정
- **완료:** 모든 local link 유효, YAML parse/validation 통과, 두 언어 체크리스트 완료

## 등록 템플릿

각 이슈 본문에는 배경, 정확한 파일, 범위 밖 항목, 합성 입력/기대 출력, 실행 명령, 합격 기준과 질문 가능한 maintainer를 적습니다. 첫 기여자가 재현할 수 없는 외부 서비스나 비공개 데이터에 의존시키지 않습니다.
