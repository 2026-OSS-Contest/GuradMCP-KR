# Commit convention

**English** | [한국어](commit-convention.md)

GuardMCP-KR uses the [Angular commit-message format](https://github.com/angular/angular/blob/main/contributing-docs/commit-message-guidelines.md) with [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/) compatibility. It keeps history readable and makes release notes and impact analysis automatable.

## Format

```text
<type>(<scope>)!: <subject>

<optional body>

<optional footer>
```

- `type` is required.
- Use `scope` when the affected area is clear.
- Add `!` after the type or scope for an incompatible change and explain it in a `BREAKING CHANGE:` footer.
- Write the subject in imperative, present-tense English, without a trailing period; 72 characters or fewer is recommended.
- Use the body to explain **why** the change is needed and how behavior differs.
- Use footers for traceability such as `Closes #123`, `Refs #123`, and `BREAKING CHANGE: ...`.

## Types

| Type | Use it for | Example |
| --- | --- | --- |
| `feat` | User-observable functionality | Support a new policy action |
| `fix` | Incorrect behavior | Fix missing masking |
| `docs` | Documentation-only changes | Expand the contribution guide |
| `style` | Formatting with no behavior change | Apply formatter output |
| `refactor` | Code structure without a feature or fix | Simplify evaluator branches |
| `perf` | Performance improvements | Reduce detector allocations |
| `test` | Adding or correcting tests | Add a gateway regression test |
| `build` | Build system or external dependencies | Change Gradle or npm configuration |
| `ci` | CI workflows and automation | Update a required check |
| `chore` | Maintenance without direct product or test behavior | Update ignore rules |
| `revert` | Reverting an earlier commit | Restore a policy change |
| `design` | UI tokens, design assets, or specifications | Change console color tokens |

`design` is a repository extension for UI work. Use `feat` or `fix` when application behavior also changes.

## Scopes

Use a short, lowercase repository area. Before introducing a new scope, choose the closest existing value:

- applications: `console`, `demo-agent`, `demo-tools`;
- runtime: `gateway`, `policy-engine`, `control-plane`;
- detection and policy: `pii`, `secret`, `injection`, `policy-pack`, `attack-lab`; and
- infrastructure: `deps`, `docker`, `ci`, `docs`.

Omit the scope when several areas are affected equally. Do not use a filename or issue number as the scope.

## Examples

```text
feat(policy-engine): support approval timeout rules

fix(pii): avoid masking version-like phone numbers

docs(contributing): document the dev branch workflow

ci(licenses): retain dependency reports for 90 days

feat(gateway)!: reject requests without policy metadata

BREAKING CHANGE: gateway clients must send policy metadata with every request.
Closes #321
```

## Atomic commits

- One commit contains one independently explainable and revertible intent.
- Keep an implementation with the direct tests that prove its behavior.
- Keep generated output with the source that generates it.
- Separate unrelated refactoring, formatting, and dependency updates.
- Do not use subjects such as `wip`, `update`, `fix stuff`, or `changes` that hide intent.

Small follow-up commits are acceptable during review, but every commit in the final history must follow this convention. Follow the maintainer's pull-request merge policy for merge or squash behavior.
