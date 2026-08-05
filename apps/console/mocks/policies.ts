// SCR-302 Policy Builder fixtures (spec §5.5), mirroring the packs that actually ship in
// `policy-packs/` — same ids, priorities, actions and severities, so the screen shows what a
// real load would.
//
// Two entries have no counterpart on disk, because the design needs states the shipping packs
// do not contain: `developer-relaxed` is a disabled, empty pack (the tree's off/zero row), and
// `warn_external_url_fetch` is the dry-run policy the table dims and the stats panel counts.

import type { DryRunStat, PolicyPack, PolicyRow } from "@/lib/api/types";

/** Packs without their counts — `PACKS` fills those in from `POLICIES` so the two cannot drift. */
const PACK_DEFINITIONS: Omit<PolicyPack, "policyCount">[] = [
  {
    name: "default",
    version: "1.0.0",
    description: "Baseline protection for risky files, secrets, and prompt injection",
    extends: [],
    enabled: true
  },
  {
    name: "korean-pii",
    version: "1.0.0",
    description: "Korean PII masking and external-disclosure controls",
    extends: ["default@^1.0.0"],
    enabled: true
  },
  {
    name: "developer-relaxed",
    version: "0.1.0",
    description: "Loosened rules for local development; ships disabled",
    extends: ["korean-pii@^1.0.0"],
    enabled: false
  }
];

export const POLICIES: PolicyRow[] = [
  {
    id: "block_env_file_read",
    pack: "default",
    priority: 100,
    action: "block",
    severity: "critical",
    enabled: true,
    firedLast30d: 14,
    path: "policy-packs/default/policies/block-env-file-read.yaml"
  },
  {
    id: "block_untrusted_injection_response",
    pack: "default",
    priority: 120,
    action: "block",
    severity: "critical",
    enabled: true,
    firedLast30d: 7,
    path: "policy-packs/default/policies/block-injection-response.yaml"
  },
  {
    id: "warn_injection_request",
    pack: "default",
    priority: 130,
    action: "warn",
    severity: "medium",
    enabled: true,
    firedLast30d: 33,
    path: "policy-packs/default/policies/warn-injection-request.yaml"
  },
  {
    id: "approve_external_email_with_korean_pii",
    pack: "korean-pii",
    priority: 180,
    action: "require_approval",
    severity: "high",
    enabled: true,
    firedLast30d: 12,
    path: "policy-packs/korean-pii/policies/require-approval-external-pii-email.yaml"
  },
  {
    id: "approve_external_email_with_secret",
    pack: "default",
    priority: 200,
    action: "require_approval",
    severity: "high",
    enabled: true,
    firedLast30d: 5,
    path: "policy-packs/default/policies/require-approval-external-secret-email.yaml"
  },
  {
    id: "mask_korean_pii_response",
    pack: "korean-pii",
    priority: 300,
    action: "mask_then_allow",
    severity: "high",
    enabled: true,
    firedLast30d: 212,
    path: "policy-packs/korean-pii/policies/mask-korean-pii-response.yaml"
  },
  {
    // The design's dimmed last row: evaluating but acting on nothing, so it has no fired count.
    id: "warn_external_url_fetch",
    pack: "korean-pii",
    priority: 320,
    action: "warn",
    severity: "medium",
    enabled: false,
    dryRun: true,
    firedLast30d: null,
    path: "policy-packs/korean-pii/policies/warn-external-url-fetch.yaml"
  }
];

/** The read-only YAML behind each row, shaped like the files on disk rather than prettified. */
export const POLICY_YAML: Record<string, string> = {
  block_env_file_read: `id: block_env_file_read
pack: default
version: 1
description: Block reads of credential-bearing files
priority: 100
match:
  direction: request
  tool: read_file
  server_trust: any
  args:
    path_regex: '(^|/)(\\.env(\\..*)?|id_(rsa|ed25519)|credentials(\\.json)?)$'
action: block
severity: critical
message: Credential-file access was blocked by policy.
reasonCode: SECRET_FILE_ACCESS_BLOCKED`,
  block_untrusted_injection_response: `id: block_untrusted_injection_response
pack: default
version: 1
description: Block high-risk prompt injection returned by an untrusted MCP server
priority: 120
match:
  direction: response
  tool: '*'
  server_trust: untrusted
  detections:
    any_of: [INJECTION, INJECTION.INDIRECT, INJECTION.OBFUSCATED]
  risk_score:
    gte: 90
action: block
severity: critical
message: Tool output was blocked because it matched a high-risk injection policy.
reasonCode: PROMPT_INJECTION_DETECTED`,
  warn_injection_request: `id: warn_injection_request
pack: default
version: 1
description: Warn on injection-shaped instructions leaving the agent
priority: 130
match:
  direction: request
  tool: '*'
  detections:
    any_of: [INJECTION]
action: warn
severity: medium
message: Request text matched an injection pattern.`,
  approve_external_email_with_korean_pii: `id: approve_external_email_with_korean_pii
pack: korean-pii
version: 1
description: Hold external mail carrying Korean PII for a human decision
priority: 180
match:
  direction: request
  tool: send_email
  args:
    to_regex: '@(?!example\\.com$)'
  detections:
    any_of: [PII.RRN_LIKE, PII.PHONE]
action: require_approval
severity: high
approval:
  timeout_seconds: 120
  on_timeout: block
  allow_masked_approval: true`,
  approve_external_email_with_secret: `id: approve_external_email_with_secret
pack: default
version: 1
description: Hold external mail carrying secrets for a human decision
priority: 200
match:
  direction: request
  tool: send_email
  detections:
    any_of: [SECRET]
action: require_approval
severity: high
approval:
  timeout_seconds: 120
  on_timeout: block`,
  mask_korean_pii_response: `id: mask_korean_pii_response
pack: korean-pii
version: 1
description: Mask Korean PII on its way back to the agent
priority: 300
match:
  direction: response
  tool: '*'
  detections:
    any_of: [PII.RRN_LIKE, PII.PHONE, PII.CARD]
action: mask_then_allow
severity: high
message: 응답에서 개인정보를 마스킹했습니다.`,
  warn_external_url_fetch: `id: warn_external_url_fetch
pack: korean-pii
version: 1
description: Dry-run — measure how often external fetches would be flagged
priority: 320
match:
  direction: request
  tool: fetch_url
action: warn
severity: medium
enabled: false`
};

export const PACKS: PolicyPack[] = PACK_DEFINITIONS.map((pack) => ({
  ...pack,
  policyCount: POLICIES.filter((policy) => policy.pack === pack.name).length
}));

/** Dry-run counts: verdicts these policies would have produced without acting on anything. */
export const DRY_RUN_STATS: DryRunStat[] = [
  { policyId: "warn_external_url_fetch", wouldFire: 62, windowDays: 30 }
];

export function policyYaml(id: string): string {
  return POLICY_YAML[id] ?? `id: ${id}\n# 이 정책의 정의를 찾지 못했습니다.`;
}

// ── Session state ───────────────────────────────────────────────────────────
// Toggling in the real system means editing a file and reloading the pack. Here a toggle simply
// sticks for the session, so a refetch agrees with what the operator just did.

let packs: PolicyPack[] = [];
let policies: PolicyRow[] = [];
let revision = 0;
/** Which scenario the arrays above were built for; re-seeding on every request would undo toggles. */
let seededEmpty: boolean | null = null;

export function seedPolicies(empty: boolean): void {
  if (seededEmpty === empty) return;
  seededEmpty = empty;
  packs = empty ? [] : PACKS.map((pack) => ({ ...pack }));
  policies = empty ? [] : POLICIES.map((policy) => ({ ...policy }));
}

export const currentPacks = (): PolicyPack[] => packs;
export const currentPolicies = (): PolicyRow[] => policies;
export const currentRevision = (): string => `r${revision}`;

/** Flips one policy; `undefined` for an unknown id, which the handler answers with a 404. */
export function togglePolicy(id: string, enabled: boolean): PolicyRow | undefined {
  const row = policies.find((policy) => policy.id === id);
  if (!row) return undefined;
  row.enabled = enabled;
  revision += 1;
  return row;
}

/** Flips a whole pack. The policies keep their own `enabled`; the pack gates them on top. */
export function togglePack(name: string, enabled: boolean): PolicyPack | undefined {
  const pack = packs.find((entry) => entry.name === name);
  if (!pack) return undefined;
  pack.enabled = enabled;
  revision += 1;
  return pack;
}
