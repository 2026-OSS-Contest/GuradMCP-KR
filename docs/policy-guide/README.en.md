# Policy Authoring Guide — DSL v1

**English** | [한국어](README.md)

This is the author-facing reference for Appendix A Policy DSL v1. It presents policy structure, evaluation, examples, validation, and the pull-request benchmark gate as one workflow so a new contributor can author a policy from this document alone.

## 1. Create a first policy in ten minutes

1. Copy `policy-packs/default/policies/block-env-file-read.yaml` within the same pack.
2. Change the filename and `id`, then narrow `match` as shown below.
3. Run `npm run policy:validate` to check structure.
4. Add attack and benign fixtures, then run `npm run bench` for regressions.

```yaml
id: block_private_key_read
pack: default
version: 1
description: Block reads of private-key files
priority: 110
match:
  direction: request
  tool: read_file
  server_trust: any
  args:
    path_regex: '(^|/)(id_(rsa|ed25519)|[^/]+\.pem)$'
action: block
severity: critical
message: Private-key access was blocked by policy.
```

Save it as `policy-packs/default/policies/block-private-key-read.yaml`. The `id` must be unique across the active pack graph. Examples must not contain live secrets or real personal data.

## 2. Complete policy document

| Field | Required | Type/value | Meaning |
| --- | --- | --- | --- |
| `id` | yes | snake_case string | stable global identifier in audit logs and the UI |
| `pack` | yes | pack name | must equal the manifest `name` |
| `version` | yes | `1` | DSL major version |
| `description` | recommended | string | human-readable intent |
| `priority` | yes | non-negative integer | lower values evaluate first |
| `match` | yes | object | six condition axes below; different axes use AND |
| `action` | yes | one of five values | candidate verdict when matched |
| `severity` | yes | one of five values | security significance of the event |
| `message` | recommended | string | user message with no sensitive source text |
| `approval` | conditional | object | required for `require_approval` |
| `dry_run` | optional | boolean, default `false` | "observation mode" — matching and judgment still happen, but the real action (masking/approval queue/block) never sees it. Unlike `enabled: false`, it isn't excluded from evaluation. Used to verify a new policy against real traffic with no risk (SPEC-POL-04). |

Unknown fields, bad enum values, an empty `match`, duplicate IDs, and mismatched pack names are validation errors. Single-quote regular expressions in YAML to avoid backslash escapes.

## 3. The six `match` axes

Different axes in one policy must **all match (AND)**. `any_of` and lists within an axis follow their documented OR behavior. An omitted axis imposes no restriction, but explicitly stating `direction`, `tool`, and `server_trust` is recommended.

### 3.1 `direction`

| Value | Inspected side |
| --- | --- |
| `request` | call and arguments from Agent to MCP Tool |
| `response` | result and description from MCP Tool to Agent |
| `any` | both directions |

Risky tools and destinations usually belong on `request`; PII exfiltration and indirect injection usually belong on `response`. Avoid `any` unless both directions are necessary.

**Credentials follow the same asymmetry.** A secret arriving in a response is masked and delivered by `mask_secret_response` — the lookup itself is legitimate work, so the answer is to remove the Agent's reason to see the key, not to block the call. A secret in a request the Agent is about to *send* goes to `approve_external_email_with_secret` for human approval instead. Masking on the request direction would hide an exfiltration attempt rather than stop it.

**Direction-split strength (FR-INJ-03).** The `default` pack treats the same injection detection differently per direction. The response direction carries external data the Agent is about to trust, so `block_untrusted_injection_response` **blocks** it; the request direction carries text the user or Agent authored, where the same wording is often a legitimate quote, so `warn_injection_request` only **warns and records**. One payload therefore yields different verdicts depending on direction. Preserve this asymmetry in new detection policies — blocking the request direction as well breaks ordinary work.

### 3.2 `tool`

A single case-sensitive string using exact matching or glob (`*`, `?`).

```yaml
tool: send_email   # exact
tool: read_*       # glob
tool: '*'          # every tool; combine with another narrow condition
```

The glob matches the complete tool name; regular expressions are not accepted. A response uses its originating request's tool name.

### 3.3 `server_trust`

| Value | Meaning |
| --- | --- |
| `trusted` | ownership, operation, and definition snapshot are verified |
| `limited` | approved for a constrained permission or data scope |
| `untrusted` | external or unverified server |
| `any` | every trust class |

An unknown server or missing trust configuration normalizes to `untrusted` as a fail-safe. `any` matches regardless of classification.

A list is also accepted (`server_trust: [limited, untrusted]`). Values inside the list are OR-combined, so a policy can target "every grade except trusted" without one rule per grade. `any` cannot be mixed into a list.

### 3.4 `args`

A condition map over the request's JSON argument object. Join a top-level argument name and its operator with `_`.

| Form | Value | Meaning |
| --- | --- | --- |
| `<name>` | scalar | exact equality |
| `<name>_regex` | string | partial/full match over a safe JavaScript-regex subset (512 characters maximum; no backreferences, lookbehind, or repeated nested/alternating groups) |
| `<name>_glob` | string | glob over the stringified value |
| `<name>_in` | list | exactly equals one listed value |
| `<name>_not_in` | list | equals none of the listed values |
| `<name>_domain` | domain list | email/URL host equals or is a subdomain of an allowed domain |
| `<name>_not_domain` | domain list | email/URL host belongs to none of the domains |
| `<name>_exists` | boolean | tests field presence |

Conditions within `args` use AND. A missing argument fails every operator except `*_exists: false`. Domain comparison lowercases and removes a trailing dot, then compares label boundaries: `evilcompany.co.kr` is not under `company.co.kr`.

```yaml
args:
  path_regex: '(^|/)(\.env(\..*)?|id_rsa|credentials(\.json)?)$'
  mode_in: [read, preview]
  recursive: false

args:
  to_not_domain: [company.co.kr]
  body_exists: true
```

**`path_regex` is special (FR-SEC-04).** When `<name>` is exactly `path`, the matcher probes `path`, then `file_path`, then `filename` for the first string field, and normalizes it before matching — repeated percent-decoding (up to 3 rounds), NFKC, null-byte truncation and control-char stripping, `~`/`$HOME` expansion, `.`/`..` resolution, then lowercasing (`packages/policy-engine/src/pathNormalize.ts`). The regex is tested against both the normalized full path and its basename, so variants like `./config/../.env`, `%2e%65%6e%76`, `id_rsa%00.png`, and `~/credentials.json` all resolve to `.env`/`id_rsa`/`credentials.json` and match. Any other `<name>_regex` skips this normalization and matches the raw value as-is.

### 3.5 `detections`

Matches normalized detector tags. Tags are hierarchical, for example `SECRET`, `INJECTION.INDIRECT`, `PII.PHONE`, and `PII.RRN_LIKE`; parent `PII` matches every `PII.*` tag.

| Key | Rule |
| --- | --- |
| `any_of` | at least one listed tag exists |
| `all_of` | every listed tag exists |
| `none_of` | no listed tag exists |
| `min_count` | at least N matching detections (integer, 1 or more) |

When keys are combined, all keyed conditions must pass. If detectors did not run, the detection set is empty and can satisfy only `none_of`.

**`min_count` counts detections, not distinct tags.** It counts the detections in scope of `any_of` (or `all_of`) when one is present, and every detection otherwise.

```yaml
detections:
  any_of: [PII]
  min_count: 10   # ten PII detections, not ten kinds of PII
```

It exists because `risk_score` cannot express bulk disclosure: that number folds in server trust, so **a single PII span from an untrusted server (80) outranks a twelve-span dump from a trusted one (71)**. The bands overlap, and no threshold selects "bulk" alone. Counting the spans is the only condition that says what it means. See `policy-packs/korean-pii/policies/require-approval-bulk-pii-response.yaml` for a shipped example.

```yaml
detections:
  any_of: [SECRET, PII.RRN_LIKE]
  none_of: [TEST_FIXTURE]
```

### 3.6 `risk_score`

Compares a normalized integer score from 0 through 100.

| Key | Meaning |
| --- | --- |
| `gte` | score ≥ value |
| `lte` | score ≤ value |

Use either or both. Together they form a closed range and require `gte <= lte`. An event whose score has not been computed does not match.

The weights behind the score and its bands (warn 40 / approval 70 / block 90) are documented in [Risk score formula](../risk-scoring.en.md).

```yaml
risk_score:
  gte: 70
  lte: 89
```

## 4. Five actions

| Action | Meaning | Execution/audit behavior |
| --- | --- | --- |
| `allow` | explicit pass | execute unchanged and record matches |
| `warn` | pass with warning | execute unchanged, add console warning and audit event |
| `mask_then_allow` | mask detected spans, then pass | forward only masked content; source text is not stored by default |
| `require_approval` | pause for a human decision | do not execute during timeout; publish an Approval Card |
| `block` | deny immediately | do not call/forward; return an error without sensitive text |

Action precedence is `block > require_approval > warn > mask_then_allow > allow`. The placement of `warn` above `mask_then_allow` is the Appendix A v1 composition rule and is independent of severity.

This section is the normative DSL v1 contract. The current demo gateway evaluates checked-in packs and applies `allow`, `warn`, `mask_then_allow`, and `block`. In the demo environment, where `docker compose` injects `CONTROL_PLANE_URL` by default, `require_approval` holds on a real Control Plane approval: an operator decides (approve, approve-masked, or block), or it fails closed automatically after the timeout (120 seconds) with no response. Without `CONTROL_PLANE_URL` set, it fails closed immediately. Approval Cards now carry real risk tags and mask previews, but the console approval UI, Replay, and the hash chain are not yet wired to these approval events — see the [external-email approval demo](../external-email-approval-demo.en.md) for details. Durable audit logs are future work and must not be assumed in the demo.

## 5. Five severities

| Severity | Guideline | Example |
| --- | --- | --- |
| `info` | observation without security impact | explicit allow audit |
| `low` | low confidence or small impact | weak pattern from a trusted server |
| `medium` | realistic risk needing review | risky tool on a limited server |
| `high` | likely sensitive-data loss or privileged action | external email with PII |
| `critical` | clear, immediate credential or authority loss | read of `.env` or a private key |

Severity informs explanation, sorting, and alerts; it does not choose an action automatically. A `critical`/`warn` pair is valid but must be justified in review.

## 6. Evaluation order, strategies, precedence, and defaults

1. Topologically sort active pack `extends` and load parents first. Cycles, missing packs, and duplicate policy IDs fail startup and validation.
2. Evaluate active policies by ascending `priority`, then lexicographic `id` for ties.
3. Different axes of each `match` use AND.
4. Compose matches using the manifest `evaluation_strategy`:
   - `first-match`: immediately select the first matched action.
   - `severity-max` (default): evaluate all matches and select the action with greatest precedence. For ties, select the representative policy by severity (`critical` through `info`), priority, then ID.
5. If nothing matches, use the final active pack's `default_action`. When omitted, it is `allow` in normal mode or `warn` in strict mode.
6. Every verdict event records all matched policy IDs in evaluation order, not only the representative policy.

With `first-match`, give specific block/approval policies lower numeric priorities than broad allow policies. Priority remains relevant for representative evidence and determinism under `severity-max`.

## 7. The `approval` block

It is required only for `action: require_approval`.

```yaml
approval:
  timeout_seconds: 120
  on_timeout: block
  allow_masked_approval: true
```

| Field | v1 rule | Default |
| --- | --- | --- |
| `timeout_seconds` | integer 1–3600 | `120` |
| `on_timeout` | v1 accepts only fail-closed `block` | `block` |
| `allow_masked_approval` | offers the operator “approve after masking” | `true` |

The operator chooses block, approve after masking when enabled, or approve unchanged. Record actor, time, choice, and matched policy. Do not execute the upstream tool before the timeout expires or a decision arrives.

## 8. Pack layout, manifest, and `extends`

```text
policy-packs/
  default/
    pack.yaml
    policies/
      block-env-file-read.yaml
      block-injection-response.yaml
      require-approval-external-secret-email.yaml
  korean-pii/
    pack.yaml
    policies/
      mask-korean-pii-response.yaml
      require-approval-external-pii-email.yaml
```

Example `pack.yaml`:

```yaml
name: korean-pii
version: 1.0.0
description: Mask Korean PII and control external disclosure
dsl_version: 1
default_action: allow
evaluation_strategy: severity-max
extends:
  - default@^1.0.0
policies:
  - policies/mask-korean-pii-response.yaml
  - policies/require-approval-external-pii-email.yaml
```

- `name` equals the directory and each policy's `pack`.
- `version` is pack SemVer; bump it when policy meaning changes.
- `dsl_version` is `1` for this guide.
- `default_action` accepts any action; reusable packs should normally choose `allow` or `warn`.
- `evaluation_strategy` is `severity-max` or `first-match`.
- `extends` lists `pack@semver-range`; parents load first and the child manifest selects strategy/default.
- `policies` contains paths relative to the pack directory. `priority`, not list order, controls evaluation.
- `default_dry_run` (optional, boolean) is the `dry_run` value a policy in this pack inherits when it doesn't declare its own. Use it to trial an entire new policy pack in observation mode.

A duplicate policy `id` anywhere in the extended graph is an error rather than a silent override. Propose a change to the parent version or add a new ID with a stronger condition.

## 9. Annotated reference examples

### `default`

[`block-env-file-read.yaml`](../../policy-packs/default/policies/block-env-file-read.yaml) combines request/tool/args to block credential paths. [`block-injection-response.yaml`](../../policy-packs/default/policies/block-injection-response.yaml) combines response/detections/server trust/risk. [`require-approval-external-secret-email.yaml`](../../policy-packs/default/policies/require-approval-external-secret-email.yaml) demonstrates the complete approval block.

### `korean-pii`

[`mask-korean-pii-response.yaml`](../../policy-packs/korean-pii/policies/mask-korean-pii-response.yaml) masks only detected `PII.*` spans in a tool response. [`require-approval-external-pii-email.yaml`](../../policy-packs/korean-pii/policies/require-approval-external-pii-email.yaml) requires a person when an external domain and PII occur together. [`pack.yaml`](../../policy-packs/korean-pii/pack.yaml) shows how it extends [`default`](../../policy-packs/default/pack.yaml).

## 10. Author, validate, benchmark, and submit

```bash
# 1) YAML, manifest, enum, duplicate-ID checks, and Gateway runtime-policy generation
npm run policy:validate

# 2) recall, FPR, attack block rate, and 10KB p95
npm run bench

# 3) optional complete local gate
npm run check
```

After schema validation succeeds, `npm run policy:validate` deterministically regenerates `packages/gateway/src/policies.generated.ts`. A policy-pack contributor commits that generated change with the YAML change. CI fails closed when the generated output differs from manifests/policies; never edit the generated file by hand.

Add at least one matching and one non-matching fixture. Add synthetic positive and negative data for a detector policy. In the pull request, report intended verdict changes, recall/FPR/p95/block rate, and baseline differences. The [policy-pack benchmark gate](../benchmark-gate.en.md) defines thresholds and failure handling.

### Regression-fixture contract

Put only policy-regression YAML fixtures below `attack-lab/policy-fixtures/<contribution>/`. Keep general PII and attack datasets under `attack-lab/datasets/`; they are not coerced into fixtures. The benchmark recursively discovers `.yaml` and `.yml` files in the fixture directory, evaluates them against every shipped policy, fails on schema errors or verdict differences, and lists every fixture ID and result in its JSON report. Every shipped policy needs both one `match` and one `not_match` fixture.

```yaml
id: unique_synthetic_fixture_id
coverage:
  policy_id: your_policy_id
  expectation: match # use not_match in the opposite fixture
event:
  direction: response
  tool: fetch_url
  server_trust: untrusted
  args: {} # optional; omit when unused
  detections: [INJECTION.OBFUSCATED]
  risk_score: 85
  content: Synthetic text only; content documents intent and is not matched in DSL v1.
expected:
  action: block
  matched_policy_ids: [your_policy_id]
```

Use a stable, unique `id`. `coverage.policy_id` names the actual policy and `coverage.expectation` is `match` or `not_match`; it must agree with `expected.matched_policy_ids`. All enum and tag values follow this guide. A benign fixture normally expects the pack default action and an empty `matched_policy_ids` list. Both fixtures must use synthetic content. In `npm run bench` output, confirm both `metrics.fixturePassRate` and `metrics.fixtureCoverageRate` are `1`, `metrics.authorFixtures` is at least twice `metrics.policyCount`, and the `fixtures` array names each added ID with `passed: true`.

### Policy Unit Test Framework (deterministic policy unit tests)

Where `npm run bench` (Benchmark Runner) measures statistical performance (recall/FPR), `packages/policy-engine/test/policy-table.test.ts` is a separate, lower-level gate that deterministically checks whether each individual policy decides exactly what its spec says. Every policy file under `policy-packs/default/` must have a matching case file, or the coverage script fails CI.

1. Write `policy-packs/<pack>/policies/<policy-file>.yaml`.
2. Write `packages/policy-engine/test/fixtures/<pack>/<policy-id>.cases.yaml` (the filename is the kebab-case spelling of `id`). Each policy needs at least one positive case (the policy matches and produces the stated action).
3. Run `npm run test:policy --workspace @guardmcp/policy-engine` locally, then open the PR.
4. Confirm the `policy-tests` CI workflow passes.

See `docs/task-docs/GMCP-16/policy-unit-test-framework.md` §4 for the case file's 3-tuple schema (policy YAML + input context + expected verdict).

## 11. Author checklist

- [ ] Is `id` globally unique and semantically stable?
- [ ] Are `direction`, `tool`, and `server_trust` no broader than necessary?
- [ ] Do synthetic positive and negative fixtures test each argument regular expression?
- [ ] Are source PII and secrets absent from messages and fixtures?
- [ ] Do action and severity match the impact?
- [ ] Is approval timeout fail-closed?
- [ ] Are Korean and English explanations/examples updated together?
- [ ] Do validation and the benchmark pass?
- [ ] Did you add a `test:policy` case file with at least one positive case?

Use the [author test](author-test.en.md) to verify that an external contributor can create a policy from documentation alone.

## 12. SCR-302 empty-state copy

When the Policy screen has no policies, direct the user to this guide. Use the exact Korean/English text and links in [SCR-302 UX copy](../ux/scr-302-empty-state.en.md).
