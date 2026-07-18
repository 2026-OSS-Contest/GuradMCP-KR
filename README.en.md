# GuardMCP-KR

**English** | [한국어](README.md)

> Every tool call, inspected.

GuardMCP-KR is an open-source, Korean privacy-first security gateway that inspects requests and responses between AI agents and MCP servers. It combines YAML policies, Korean PII/secret/prompt-injection detections, and a risk score to return one of `allow`, `warn`, `mask_then_allow`, `require_approval`, or `block`.

> [!IMPORTANT]
> This repository is in early development. Review policies and deployment settings before using real personal data or production credentials. Use unique secrets and a restricted network in production.

## Five-minute quick start

Prerequisites: Docker Engine 24+ and Compose v2.20+. Local ports `3000`, `8080`, `5432`, and `6379` must be available.

```bash
git clone https://github.com/2026-OSS-Contest/GuradMCP-KR.git
cd GuradMCP-KR
docker compose --profile demo up -d --build
docker compose ps
```

Open <http://localhost:3000> after every service is `healthy`. The demo profile starts deterministic seed data, the Demo Agent, and demo MCP Tools. Stop and remove the demo with:

```bash
docker compose --profile demo down -v
```

See the [Quick Start](docs/quickstart.en.md) for a timed verification checklist, expected health, and troubleshooting. Use `docker compose up -d` for product services only, or `docker compose --profile dev up -d` to include the development-mode demo services.

## How it works

```text
AI Agent → GuardMCP-KR Gateway → MCP Tools
                │
                ├─ bidirectional detection and policy evaluation
                ├─ Control Plane / Approval / Replay
                └─ PostgreSQL + Redis
```

- **Bidirectional inspection:** checks risky tools and arguments on requests, and PII, secrets, and indirect injection on responses.
- **Explainable verdicts:** records the policy ID, detection type, risk score, and masking result in audit events.
- **Korean defaults:** covers Korean phone numbers, RRN-like values, business registration numbers, bank accounts, and more.
- **No-code extension:** policies and detection/attack samples can be contributed as YAML or datasets.

## Author a policy

The [Policy Authoring Guide](docs/policy-guide/README.en.md) documents every DSL v1 `match` axis, all five actions, evaluation rules, the approval block, and policy-pack layout. Runnable examples live in [`policy-packs/default`](policy-packs/default) and [`policy-packs/korean-pii`](policy-packs/korean-pii).

Every policy-pack pull request must pass:

```bash
npm run policy:validate
npm run bench
```

See the [policy-pack benchmark gate](docs/benchmark-gate.en.md) for measured metrics and regression thresholds.

## Contributing

Contributions do not have to contain application code:

- add one policy rule;
- add a Korean PII pattern with positive and negative samples;
- add attack or benign dataset samples; or
- improve documentation, translation, or accessibility.

See [CONTRIBUTING.md](CONTRIBUTING.md#english) and the [good-first-issue design](docs/contributing/good-first-issues.en.md). All participants must follow the [Code of Conduct](CODE_OF_CONDUCT.md#english).

## Security

Do not disclose vulnerabilities in public issues. [SECURITY.md](SECURITY.md#english) explains GitHub private vulnerability reporting and the fallback private channel.

## Documentation

| Document | English | 한국어 |
| --- | --- | --- |
| Quick Start | [Open](docs/quickstart.en.md) | [열기](docs/quickstart.md) |
| Policy Authoring Guide | [Open](docs/policy-guide/README.en.md) | [열기](docs/policy-guide/README.md) |
| Benchmark gate | [Open](docs/benchmark-gate.en.md) | [열기](docs/benchmark-gate.md) |
| Contribution guide | [Open](CONTRIBUTING.md#english) | [열기](CONTRIBUTING.md#한국어) |
| Security policy | [Open](SECURITY.md#english) | [열기](SECURITY.md#한국어) |

## License

[Apache License 2.0](LICENSE). Copyright 2026 The GuardMCP-KR Contributors.
