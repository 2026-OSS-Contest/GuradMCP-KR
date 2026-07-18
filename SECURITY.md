# 보안 정책 / Security Policy

## 한국어

[English](#english)

GuardMCP-KR은 MCP 트래픽과 민감정보를 다루므로 책임 있는 비공개 제보를 중요하게 생각합니다.

### 지원 범위

| 버전 | 보안 업데이트 |
| --- | --- |
| 최신 `main` 및 최신 릴리스 | 지원 |
| 이전 릴리스 | 최선의 노력 |

### 취약점 비공개 제보

**공개 Issue, Discussion 또는 Pull Request에 취약점 세부사항을 올리지 마세요.**

1. 저장소의 [Report a vulnerability](https://github.com/2026-OSS-Contest/GuradMCP-KR/security/advisories/new)를 열어 GitHub Private Vulnerability Reporting으로 초안을 보냅니다.
2. 취약한 버전/commit, 영향받는 구성요소, 재현 절차, 예상 영향과 가능한 완화책을 적습니다.
3. 로그와 증거에서 실제 개인정보와 유효한 비밀값을 제거합니다. 필요한 경우 합성 fixture를 사용합니다.

이 채널의 보고서는 저장소 보안 권한이 있는 maintainer에게만 공개됩니다. GitHub 화면에 비공개 제보 버튼이 보이지 않으면 세부사항을 공개하지 말고, 저장소 소유 조직의 GitHub 프로필에 표시된 비공개 연락 수단으로 maintainer에게 기능 활성화를 요청하세요.

### 대응 목표

- 3영업일 안에 수신 확인
- 7영업일 안에 초기 분류와 다음 업데이트 일정 공유
- 수정과 공지 시점은 제보자와 조율

실제 소요 시간은 영향과 수정 난이도에 따라 달라질 수 있습니다. 수정 또는 완화가 공개될 때까지 세부사항을 비공개로 유지해 주세요.

### 범위 예시

- gateway 우회, fail-open 오동작, 정책 평가 오류
- 인증/권한 우회, approval 조작, SSRF/RCE
- 로그·Replay·오류 메시지를 통한 PII/Secret 유출
- 정책팩 또는 컨테이너 공급망 변조
- 탐지 회피 중 별도 보안 경계를 무너뜨리는 재현 가능한 사례

일반적인 탐지 품질 개선, 새 패턴 제안, 문서 오류는 민감한 재현 정보가 없다면 공개 Issue를 사용해도 됩니다.

### 세이프 하버

선의로 이 정책을 따르고, 개인정보를 최소화하며, 서비스 중단·데이터 파괴·타인 계정 접근을 피하는 연구에 대해 프로젝트는 협력적으로 대응하고 먼저 법적 조치를 추진하지 않습니다. 타인의 데이터나 제3자 시스템에는 별도 허가가 필요합니다.

---

## English

[한국어](#한국어)

Because GuardMCP-KR handles MCP traffic and sensitive data, we take responsible private disclosure seriously.

### Supported versions

| Version | Security updates |
| --- | --- |
| Latest `main` and latest release | Supported |
| Older releases | Best effort |

### Report a vulnerability privately

**Do not disclose vulnerability details in a public issue, discussion, or pull request.**

1. Open [Report a vulnerability](https://github.com/2026-OSS-Contest/GuradMCP-KR/security/advisories/new) and submit a draft through GitHub Private Vulnerability Reporting.
2. Include the affected version or commit, component, reproduction steps, expected impact, and any known mitigation.
3. Remove real personal data and live secrets from logs and evidence. Prefer synthetic fixtures.

Reports in this channel are visible only to maintainers with repository security permissions. If GitHub does not show the private reporting button, do not publish details; use the private contact method listed on the repository owner's GitHub profile to ask a maintainer to enable it.

### Response targets

- acknowledge within three business days;
- provide an initial triage and next-update date within seven business days; and
- coordinate fix and disclosure timing with the reporter.

Actual timing depends on impact and remediation complexity. Keep details private until a fix or mitigation is public.

### Examples in scope

- gateway bypass, incorrect fail-open behavior, or policy-evaluation errors;
- authentication/authorization bypass, approval manipulation, SSRF, or RCE;
- PII or secret leakage through logs, Replay, or error messages;
- policy-pack or container supply-chain tampering; and
- reproducible detection evasion that crosses a separate security boundary.

Normal detection-quality improvements, new patterns, and documentation errors may use a public issue when they contain no sensitive reproduction details.

### Safe harbor

For good-faith research that follows this policy, minimizes personal data, and avoids disruption, data destruction, and access to other people's accounts, the project will respond cooperatively and will not initiate legal action. You still need separate authorization for third-party systems or data.
