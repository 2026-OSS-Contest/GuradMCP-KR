# Good-first-issue catalog

**English** | [한국어](good-first-issues.md)

These five ready-to-file designs are scoped to 30–90 minutes and require no application code. Apply `good first issue`, `contributions welcome`, and the area label, and assign a maintainer when filing each issue.

## 1. Add a credential-file policy for `.npmrc`

- **Labels:** `good first issue`, `policy`
- **Files:** `policy-packs/default/policies/block-env-file-read.yaml` or one new YAML, synthetic fixtures
- **Task:** block `read_file` for a home-directory `.npmrc` without falsely matching documentation such as `docs/example.npmrc`
- **Out of scope:** live npm tokens, application TypeScript changes
- **Done:** one positive + two benign negatives, validation/benchmark pass, bilingual explanation

## 2. Add business-registration-number validation samples

- **Labels:** `good first issue`, `pii`, `dataset`
- **Files:** PII benchmark data under `attack-lab/datasets/`
- **Task:** add at least three synthetic `PII.BIZ_NO` positives and three similar negatives that fail the validation formula
- **Out of scope:** copying real business identifiers, detector code changes
- **Done:** expected labels/masking tag documented, recall/FPR thresholds pass

## 3. Add Korean phone-number false-positive regressions

- **Labels:** `good first issue`, `pii`, `false-positive`
- **Files:** benign data under `attack-lab/datasets/`
- **Task:** add five synthetic date/order/version values that resemble phone numbers and two valid synthetic phone positives
- **Out of scope:** real phone numbers, lowering thresholds
- **Done:** FPR ≤ 5%, recall ≥ 90%, sample purpose documented

## 4. Add a zero-width Korean injection sample

- **Labels:** `good first issue`, `attack-lab`, `prompt-injection`
- **Files:** scenario or dataset under `attack-lab/`
- **Task:** add one synthetic T-07 attack that inserts zero-width characters into “ignore previous instructions” in Korean, plus one benign Korean sentence
- **Out of scope:** real external recipients/secrets, executable destructive commands
- **Done:** expected threat ID/verdict, passing attack-block threshold, human-readable de-obfuscation note

## 5. Add a bilingual explanation for a `korean-pii` policy

- **Labels:** `good first issue`, `documentation`, `policy`
- **Files:** `policy-packs/korean-pii/README.md`, `docs/policy-guide/README.md`, `README.en.md`
- **Task:** explain every match axis and the action choice of one existing policy with equivalent Korean and English annotations/table text
- **Out of scope:** behavior changes, updating only one language
- **Done:** all local links resolve, YAML validation passes, both language checklists complete

## Filing template

Each issue should state context, exact files, out-of-scope items, synthetic input/expected output, commands, pass criteria, and an available maintainer. Do not make a first contribution depend on private data or a service the contributor cannot reproduce.
