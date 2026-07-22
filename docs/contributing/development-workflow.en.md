# Development workflow

**English** | [한국어](development-workflow.md)

This document defines the shared local-development and pull-request process for application code, policy packs, datasets, and documentation. Read [CONTRIBUTING.md](../../CONTRIBUTING.md#english) first for contribution principles and no-code contribution paths.

## 1. Prerequisites

| Tool | Minimum | Used for |
| --- | ---: | --- |
| Node.js | 22 | TypeScript applications, packages, and scripts |
| npm | 10.9.4 (`packageManager`) | Workspace dependencies and commands |
| JDK | 21 | Control Plane |
| Docker Engine | 24 | Integrated demo and containers |
| Docker Compose | 2.20 | Local service composition |

Use `npm ci`, not `npm install`, to reproduce the lockfile exactly. Use the repository Gradle wrapper rather than a system Gradle installation for Java work.

## 2. Branch model

- `dev`: base and pull-request target for normal contributions;
- `main`: validated release candidates, managed by maintainers; and
- working branches: created from the latest `dev`.

The recommended branch format is `<type>/<issue>-<description>`. The issue may be omitted when none exists.

```text
feat/GMCP-123-policy-preview
fix/GMCP-456-mask-phone
docs/contribution-guide
ci/license-report
```

When using a fork, create the working branch from the latest upstream branch:

```bash
git fetch upstream
git switch -c feat/GMCP-123-policy-preview upstream/dev
```

Do not rewrite shared branch history or force-push to `main` or `dev`.

## 3. Install and run a fast check

```bash
npm ci
npm run lint
npm run typecheck
npm run test:unit
```

For changes involving the complete demo, also verify the Compose stack by following the [Quick Start](../quickstart.en.md).

## 4. Repository areas

| Path | Responsibility | Primary validation |
| --- | --- | --- |
| `apps/console` | Next.js console | lint, typecheck, Playwright |
| `apps/demo-agent`, `apps/demo-mcp-tools` | Demo client and MCP tools | lint, typecheck, unit tests |
| `packages/gateway` | MCP security gateway | unit/integration tests |
| `packages/policy-engine` | Policy parsing and evaluation | unit tests, policy validation |
| `services/control-plane` | Kotlin/Spring Control Plane | Gradle tests |
| `policy-packs` | YAML policy packs | policy validation, benchmark |
| `attack-lab` | Attack/benign data and benchmarks | benchmark |
| `docs` | User and contributor documentation | links, Korean/English parity |

## 5. Validation by change

Run the narrowest relevant test first, followed by the required commands in this table. The [CI and quality gates](../ci/quality-gates.md) document lists the full contract and exact required-check names.

| Change | Local validation |
| --- | --- |
| TypeScript/TSX | `npm run lint && npm run typecheck && npm run test:unit` |
| Kotlin/Java | `services/control-plane/gradlew -p services/control-plane test` |
| Console user flow | TypeScript checks above + `npm run test:e2e` |
| Policy pack, detector, or benchmark data | `npm run policy:validate && npm run bench` |
| Generated policy output | Run `npm run policy:generate`, then inspect the generated diff |
| Compose or Dockerfile | `scripts/compose-verify.sh` and the affected image/profile |
| Documentation | Resolve relative links, verify example commands, keep Korean/English content aligned |
| GitHub Actions | Validate workflow syntax and run the underlying local command |

Run the repository-wide non-browser gate with `npm run check`. Docker and browser checks are separate and must be added when the change affects them.

## 6. Commits and pull requests

1. Create atomic commits that follow the [commit convention](commit-convention.en.md).
2. Push the working branch and open a pull request whose base is `dev`.
3. In the pull-request template, leave inapplicable validation unchecked and explain why in the result summary.
4. Record user impact, intentional incompatibilities, commands and results, and the related issue.
5. Update Korean and English documentation together when a user-facing concept changes.
6. Resolve every required check and review conversation, then wait for a maintainer to merge.

Never put real personal data, production credentials, customer logs, or payloads capable of attacking external systems in a commit, issue, pull request, or CI artifact. Report vulnerabilities through the private process in [SECURITY.md](../../SECURITY.md#english).
