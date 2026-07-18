# 정책팩 / Policy packs

## 한국어

정책팩은 `pack.yaml`, `README.md`, `policies/*.yaml`로 구성됩니다. [`default`](default)는 자격증명 접근과 명백한 인젝션을 막는 기본 안전선이고, [`korean-pii`](korean-pii)는 default를 확장해 한국형 PII를 마스킹하고 외부 전송을 승인 대상으로 만듭니다.

새 팩이나 정책을 작성하기 전에 [정책 작성 가이드](../docs/policy-guide/README.md)를 읽고 다음을 실행하세요.

```bash
npm run policy:validate
npm run bench
```

실제 개인정보와 유효한 비밀값을 example/fixture에 넣지 마세요. 팩은 default action, 평가 전략, extends 제약을 README에 설명해야 합니다.

## English

A policy pack contains `pack.yaml`, `README.md`, and `policies/*.yaml`. [`default`](default) is the base safety boundary for credential access and clear injection; [`korean-pii`](korean-pii) extends it to mask Korean PII and require approval for external disclosure.

Read the [Policy Authoring Guide](../docs/policy-guide/README.en.md) before adding a pack or policy, then run:

```bash
npm run policy:validate
npm run bench
```

Never put real personal data or live secrets in examples or fixtures. A pack README must explain its default action, evaluation strategy, and extension constraints.
