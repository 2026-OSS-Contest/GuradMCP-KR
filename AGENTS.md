# GuardMCP-KR Repository Instructions

This file applies to the entire repository. A more deeply nested `AGENTS.md`, if one is added later, may refine these rules for its subtree but must not weaken the security, privacy, or verification requirements below.

## Mission and priorities

GuardMCP-KR is a privacy-first security gateway for MCP traffic. Prefer, in order:

1. safe and fail-closed behavior;
2. correct, explainable policy decisions;
3. protection of personal data and secrets;
4. small, reviewable changes; and
5. reproducible validation.

Do not claim capabilities that are not implemented. The current limitations documented in the READMEs are part of the product contract.

## Before changing files

- Read the nearest implementation, tests, and relevant documentation before editing.
- Use the Node.js and npm versions declared in the root `package.json`; do not regenerate the lockfile with a different npm major version.
- Preserve unrelated work in the working tree; never reset, overwrite, or reformat unrelated files.
- Work from the latest `dev` branch for normal changes. Target `main` only for a maintainer-directed release or hotfix.
- Keep one purpose per branch and pull request.
- Do not add a dependency when an existing utility or platform API is sufficient.
- Never include real personal data, live credentials, customer logs, or payloads that target external systems. Use synthetic fixtures only.
- Report vulnerabilities through `SECURITY.md`; do not put sensitive reproduction details in a public issue or pull request.

## Repository map

- `apps/console`: Next.js console and Playwright tests
- `apps/demo-agent`: demo agent client
- `apps/demo-mcp-tools`: synthetic demo MCP tools
- `packages/gateway`: MCP gateway and generated runtime policy bundle
- `packages/policy-engine`: policy parsing and evaluation
- `services/control-plane`: Kotlin/Spring control plane
- `policy-packs`: source YAML policy packs
- `attack-lab`: synthetic attack/benign datasets and benchmarks
- `scripts`: validation, generation, Compose, and CI support
- `docs`: Korean and English user/contributor documentation

## Implementation rules

- Follow the existing architecture and naming in the affected package. Prefer the smallest root-cause fix over a new abstraction.
- TypeScript is strict. Do not use `any`, `@ts-ignore`, `@ts-expect-error`, unchecked casts, or silently swallowed errors.
- Keep trust-boundary parsing and validation explicit. Security failures must not degrade into implicit allow behavior.
- A behavior change needs a focused regression test. Keep the implementation and its direct test together.
- Do not weaken, skip, or delete a failing test to make validation pass.
- Treat `policy-packs/**` as the source of truth. Regenerate `packages/gateway/src/policies.generated.ts` with `npm run policy:generate`; do not hand-edit generated policy output.
- Keep generated output in the same change as its source.
- For UI changes, preserve keyboard access, visible focus, semantic structure, Korean/English parity, and responsive behavior.

## Documentation rules

- Update Korean and English documents together when a user-facing concept changes.
- Keep commands executable from the repository root unless the document explicitly changes directories.
- Use relative links for repository files and verify that every new or changed link resolves.
- Keep README capability statements aligned with actual behavior and current limitations.
- Follow `CONTRIBUTING.md`, `docs/contributing/development-workflow.md`, and the matching English documents for contributor-facing changes.

## Verification

Run the narrowest relevant check first, then all checks required by the changed surface:

| Changed surface | Required validation |
| --- | --- |
| TypeScript/TSX | `npm run lint && npm run typecheck && npm run test:unit` |
| Kotlin/Java | `services/control-plane/gradlew -p services/control-plane test` |
| Console user flow | TypeScript checks + `npm run test:e2e` |
| Policy, detector, gateway, or benchmark data | `npm run policy:validate && npm run bench` |
| Generated policies | `npm run policy:check-generated` |
| Compose or Dockerfile | `scripts/compose-verify.sh` and the affected profile/image |
| Documentation | `git diff --check`, local-link validation, and command review |
| GitHub Actions | workflow syntax plus the command implemented by the workflow |

`npm run check` is the repository-wide Node/policy gate. Browser, JVM, and Docker checks remain separate. If a required check cannot run, state the exact reason and the strongest substitute evidence; do not report it as passing.

Before finishing, inspect the diff, confirm no secret or personal data was added, and report changed files, commands run, results, and any residual risk.

## Git and commits

Do not commit, push, rebase, or rewrite history unless the user explicitly requests it. When a commit is requested:

- follow `docs/contributing/commit-convention.md`;
- use `<type>: <subject>` or `<type>(<scope>): <subject>`;
- keep commits atomic and independently revertible;
- stage only files that belong to the requested change; and
- never force-push `main` or `dev`.

Pull requests for normal work target `dev` and must include user impact, related issues, and concrete validation evidence.
