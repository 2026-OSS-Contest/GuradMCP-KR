# 커밋 컨벤션

[English](commit-convention.en.md) | **한국어**

GuardMCP-KR은 [Angular 커밋 메시지 형식](https://github.com/angular/angular/blob/main/contributing-docs/commit-message-guidelines.md)을 바탕으로 하고 [Conventional Commits 1.0](https://www.conventionalcommits.org/ko/v1.0.0/)과 호환되는 형식을 사용합니다. 이 규칙은 변경 이력을 읽기 쉽게 만들고 릴리스 노트와 변경 영향 분석을 자동화할 수 있게 합니다.

## 형식

```text
<type>(<scope>)!: <subject>

<optional body>

<optional footer>
```

- `type`은 필수입니다.
- `scope`는 변경 영역이 분명할 때 사용합니다.
- 호환성이 깨지는 변경에는 type/scope 뒤에 `!`를 붙이고 footer에 `BREAKING CHANGE:`를 설명합니다.
- 제목은 영어 명령형 현재 시제로 작성하고 마침표를 붙이지 않으며 72자 이내를 권장합니다.
- 본문은 무엇보다 **왜** 바꾸는지와 이전 동작과의 차이를 설명합니다.
- footer에는 `Closes #123`, `Refs #123`, `BREAKING CHANGE: ...` 같은 추적 정보를 적습니다.

## Type

| Type | 사용 시점 | 예 |
| --- | --- | --- |
| `feat` | 사용자가 관찰할 수 있는 기능 | 새 정책 action 지원 |
| `fix` | 잘못된 동작 수정 | 마스킹 누락 수정 |
| `docs` | 문서만 변경 | 기여 가이드 보강 |
| `style` | 동작 없는 서식 변경 | formatter 결과 반영 |
| `refactor` | 기능·버그 수정이 아닌 코드 구조 변경 | 평가기 분기 단순화 |
| `perf` | 성능 개선 | detector 할당 감소 |
| `test` | 테스트 추가·수정 | gateway 회귀 테스트 |
| `build` | 빌드 시스템·외부 의존성 | Gradle 또는 npm 설정 |
| `ci` | CI 워크플로와 자동화 | required check 수정 |
| `chore` | 제품·테스트 동작에 직접 영향 없는 유지보수 | ignore 규칙 갱신 |
| `revert` | 이전 커밋 되돌리기 | 잘못된 정책 변경 복원 |
| `design` | UI 토큰·디자인 자산·명세 | 콘솔 색상 토큰 변경 |

`design`은 이 저장소의 UI 작업을 위한 확장 type입니다. 기능 동작까지 바뀌면 `feat` 또는 `fix`를 사용합니다.

## Scope

scope는 짧고 소문자인 저장소 영역을 사용합니다. 새 scope를 만들기 전에 아래 값 중 가장 가까운 것을 선택합니다.

- 앱: `console`, `demo-agent`, `demo-tools`
- 런타임: `gateway`, `policy-engine`, `control-plane`
- 탐지·정책: `pii`, `secret`, `injection`, `policy-pack`, `attack-lab`
- 기반: `deps`, `docker`, `ci`, `docs`

여러 영역을 같은 비중으로 바꾸면 scope를 생략합니다. 파일명이나 Issue 번호를 scope로 사용하지 않습니다.

## 예시

```text
feat(policy-engine): support approval timeout rules

fix(pii): avoid masking version-like phone numbers

docs(contributing): document the dev branch workflow

ci(licenses): retain dependency reports for 90 days

feat(gateway)!: reject requests without policy metadata

BREAKING CHANGE: gateway clients must send policy metadata with every request.
Closes #321
```

## 원자적 커밋

- 하나의 커밋은 독립적으로 설명하고 되돌릴 수 있는 한 가지 의도를 담습니다.
- 구현과 그 동작을 증명하는 직접 테스트는 같은 커밋에 둡니다.
- 생성 파일은 생성 원본과 같은 커밋에 둡니다.
- 무관한 리팩터링, 서식 변경, 의존성 갱신은 분리합니다.
- `wip`, `update`, `fix stuff`, `changes`처럼 의도를 설명하지 않는 제목은 사용하지 않습니다.

PR 검토 중의 작은 수정 커밋은 허용되지만, 최종 이력의 각 커밋은 위 규칙을 따라야 합니다. Merge 또는 squash 방식은 maintainer의 PR 병합 정책을 따릅니다.
