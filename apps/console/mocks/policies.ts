// SCR-302 Policy Builder fixtures (spec §5.5).
//
// The control plane serves these endpoints for real, so the mock mirrors what `PolicyStore`
// seeds — same pack ids, same policy ids, same priorities, actions and severities — and answers
// in the same shapes: bare arrays, `packId`, an integer `version`, an ISO `updatedAt`.
//
// On top of that it supplies the fields the design draws and the control plane does not report:
// `enabled`, `extends`, `dryRun`, `firedLast30d` and `path`. Those are optional on the wire
// types for exactly this reason — they are present here and absent against a real gateway.
//
// Every id, priority, action and severity below is read off the files in `policy-packs/` — the
// console used to list `mask_korean_phone` and `approve_external_email`, which exist in no pack
// (GMCP-117). The one exception is the `developer-relaxed` pack and its single dry-run policy:
// the design draws a disabled pack and a policy that measures without acting, and putting either
// state on a real policy would contradict SCR-601, where the same policy is shown enforcing.
// Keeping both inside a pack that ships disabled is the one place they cost nothing.

import type { PolicyPack, PolicyRow, PolicyStats } from "@/lib/api/types";

/** What `DemoSeed.SEEDED_AT` stands in for — a fixed instant, so renders stay deterministic. */
const SEEDED_AT = "2026-07-01T00:00:00Z";

const PACK_SEED: PolicyPack[] = [
  {
    id: "default",
    version: 1,
    enabled: true,
    description: "Deterministic default protection policy pack",
    updatedAt: SEEDED_AT,
    extends: []
  },
  {
    id: "korean-pii",
    version: 1,
    enabled: true,
    description: "Deterministic Korean PII masking policy pack",
    updatedAt: SEEDED_AT,
    extends: ["default"]
  },
  {
    id: "developer-relaxed",
    version: 1,
    enabled: false,
    description: "Loosened rules for local development; ships disabled",
    updatedAt: SEEDED_AT,
    extends: ["korean-pii"]
  }
];

/** The pack files declare these in priority order; the table sorts by it, so the seed keeps it. */

const POLICY_SEED: PolicyRow[] = [
  {
    id: "block_env_file_read",
    packId: "default",
    priority: 100,
    action: "block",
    severity: "critical",
    description: "Block reads of credential-bearing files",
    enabled: true,
    path: "policy-packs/default/policies/block-env-file-read.yaml"
  },
  {
    id: "block_untrusted_injection_response",
    packId: "default",
    priority: 120,
    action: "block",
    severity: "critical",
    description: "Block high-risk prompt injection returned by an untrusted MCP server",
    enabled: true,
    path: "policy-packs/default/policies/block-injection-response.yaml"
  },
  {
    // What a real control plane returns: the six fields `Policy` declares and nothing else. No
    // `enabled`, so the console cannot switch it; no source, so the YAML pane has none to show.
    // One row is kept this way deliberately — every screen has to survive the fields the wire
    // type marks optional actually being absent.
    id: "warn_injection_request",
    packId: "default",
    priority: 130,
    action: "warn",
    severity: "medium",
    description: "Warn on prompt-injection wording in tool arguments instead of blocking it"
  },
  {
    id: "approve_external_email_with_korean_pii",
    packId: "korean-pii",
    priority: 180,
    action: "require_approval",
    severity: "high",
    description: "Require approval before emailing Korean PII outside the organization",
    enabled: true,
    path: "policy-packs/korean-pii/policies/require-approval-external-pii-email.yaml"
  },
  {
    id: "approve_external_email_with_secret",
    packId: "default",
    priority: 200,
    action: "require_approval",
    severity: "high",
    description: "Require human approval before sending sensitive data outside the organization",
    enabled: true,
    path: "policy-packs/default/policies/require-approval-external-secret-email.yaml"
  },
  {
    id: "require_approval_untrusted_high_risk_tool",
    packId: "default",
    priority: 210,
    action: "require_approval",
    severity: "high",
    description: "신뢰 등급이 untrusted인 서버로 향하는 고위험 Tool 호출은 사람 승인을 거친다",
    enabled: true,
    path: "policy-packs/default/policies/require-approval-untrusted-high-risk-tool.yaml"
  },
  {
    id: "mask_korean_pii_response",
    packId: "korean-pii",
    priority: 300,
    action: "mask_then_allow",
    severity: "high",
    description: "Mask Korean PII detected in MCP tool responses",
    enabled: true,
    path: "policy-packs/korean-pii/policies/mask-korean-pii-response.yaml"
  },
  {
    id: "mask_secret_response",
    packId: "default",
    priority: 310,
    action: "mask_then_allow",
    severity: "high",
    description: "Mask credentials detected in MCP tool responses",
    enabled: true,
    path: "policy-packs/default/policies/mask-secret-response.yaml"
  },
  {
    // The design's dimmed last row: evaluating, acting on nothing, so it has no fired count. In
    // the disabled dev pack for the reason given at the top of this file.
    id: "warn_external_url_fetch",
    packId: "developer-relaxed",
    priority: 320,
    action: "warn",
    severity: "medium",
    description: "Dry-run — measure how often external fetches would be flagged",
    enabled: false,
    dryRun: true,
    path: "policy-packs/developer-relaxed/policies/warn-external-url-fetch.yaml"
  }
];

/**
 * The read-only YAML behind each row. These are the files in `policy-packs/` — copied rather than
 * imported because the console is a browser bundle and the packs are read by the gateway, but
 * copied verbatim, comments and all, so what the pane shows is what is actually enforced.
 */
export const POLICY_YAML: Record<string, string> = {
  block_env_file_read: `id: block_env_file_read
pack: default
version: 1
description: Block reads of credential-bearing files
priority: 100 # Lower numbers evaluate first.
match:
  direction: request # Inspect Agent -> Tool arguments.
  tool: read_file # Exact match; read_* would be a glob.
  server_trust: any # Sensitive paths are forbidden regardless of server trust.
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
  direction: response # External data entering the Agent.
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
  approve_external_email_with_korean_pii: `id: approve_external_email_with_korean_pii
pack: korean-pii
version: 1
description: Require approval before emailing Korean PII outside the organization
priority: 180
match:
  direction: request
  tool: send_email
  server_trust: any
  args:
    to_not_domain: [company.co.kr]
  detections:
    any_of: [PII]
  risk_score:
    gte: 70
action: require_approval
severity: high
approval:
  timeout_seconds: 120
  on_timeout: block
  allow_masked_approval: true
message: Sending personal data outside the organization requires approval.`,
  approve_external_email_with_secret: `id: approve_external_email_with_secret
pack: default
version: 1
description: Require human approval before sending sensitive data outside the organization
priority: 200
match:
  direction: request
  tool: send_email
  server_trust: any
  args:
    to_not_domain: [company.co.kr]
  detections:
    any_of: [SECRET, PII.RRN_LIKE]
  risk_score:
    gte: 70
action: require_approval
severity: high
approval:
  timeout_seconds: 120
  on_timeout: block # DSL v1 is fail-closed on approval timeout.
  allow_masked_approval: true
message: External transmission is waiting for human approval.`,
  require_approval_untrusted_high_risk_tool: `id: require_approval_untrusted_high_risk_tool
pack: default
version: 1
description: 신뢰 등급이 untrusted인 서버로 향하는 고위험 Tool 호출은 사람 승인을 거친다
priority: 210
match:
  direction: request
  tool: send_*
  server_trust: untrusted
action: require_approval
severity: high
approval:
  timeout_seconds: 120
  on_timeout: block
  allow_masked_approval: false
message: 미검증(untrusted) 서버로 향하는 고위험 도구 호출은 승인이 필요합니다.`,
  mask_korean_pii_response: `id: mask_korean_pii_response
pack: korean-pii
version: 1
description: Mask Korean PII detected in MCP tool responses
priority: 300
match:
  direction: response
  tool: '*' # Applies to the originating tool name.
  server_trust: any
  detections:
    # Parent tag PII matches PHONE, RRN_LIKE, BANK_ACCOUNT, and other PII.* tags.
    any_of: [PII]
action: mask_then_allow
severity: high
message: Personal-data spans were masked before the tool response was delivered.`,
  mask_secret_response: `id: mask_secret_response
pack: default
version: 1
description: Mask credentials detected in MCP tool responses
priority: 310
match:
  direction: response
  tool: '*' # Any tool can return a credential; the leak is in the payload, not the caller.
  server_trust: any
  detections:
    any_of: [SECRET]
action: mask_then_allow
severity: high
message: Credential spans were masked before the tool response was delivered.`,
  warn_external_url_fetch: `id: warn_external_url_fetch
pack: developer-relaxed
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

/**
 * What `GET /policies/{policyId}/stats` answers. The fired counts the table shows and the dry-run
 * panel's 가상 판정 are the same record read twice, which is how GMCP-80 describes the endpoint.
 *
 * The counts are a month of the story on screen, not round numbers: the masking rules fire on
 * every consultation lookup a support team makes, the file guard on the handful of times an
 * agent is talked into reading a credential file, and the approval rules once or twice a week.
 * `warn_injection_request` sits between them — injection wording is common, acting on it is not.
 */
const STATS: Record<string, PolicyStats> = {
  block_env_file_read: { policyId: "block_env_file_read", firedLast30d: 14 },
  block_untrusted_injection_response: { policyId: "block_untrusted_injection_response", firedLast30d: 9 },
  warn_injection_request: { policyId: "warn_injection_request", firedLast30d: 63 },
  approve_external_email_with_korean_pii: { policyId: "approve_external_email_with_korean_pii", firedLast30d: 7 },
  approve_external_email_with_secret: { policyId: "approve_external_email_with_secret", firedLast30d: 5 },
  require_approval_untrusted_high_risk_tool: { policyId: "require_approval_untrusted_high_risk_tool", firedLast30d: 2 },
  mask_korean_pii_response: { policyId: "mask_korean_pii_response", firedLast30d: 212 },
  mask_secret_response: { policyId: "mask_secret_response", firedLast30d: 48 },
  // In dry-run, so it has decided nothing and only reports what it would have.
  warn_external_url_fetch: {
    policyId: "warn_external_url_fetch",
    firedLast30d: null,
    dryRun: { wouldFire: 62, windowDays: 30 }
  }
};

export function policyStats(id: string): PolicyStats {
  return STATS[id] ?? { policyId: id, firedLast30d: null };
}

export function policyYaml(id: string): string {
  return POLICY_YAML[id] ?? `id: ${id}\n# 이 정책의 정의를 찾지 못했습니다.`;
}

// ── Session state ───────────────────────────────────────────────────────────
// The control plane keeps packs and policies in an in-memory `PolicyStore` and bumps a pack's
// `version` and `updatedAt` on every write, including a policy's. The mock does the same, so a
// toggle sticks across refetches exactly as it would against a real gateway.

let packs: PolicyPack[] = [];
let policies: PolicyRow[] = [];
/** Which scenario the arrays above were built for; re-seeding every request would undo toggles. */
let seededEmpty: boolean | null = null;

export function seedPolicies(empty: boolean): void {
  if (seededEmpty === empty) return;
  seededEmpty = empty;
  packs = empty ? [] : PACK_SEED.map((pack) => ({ ...pack }));
  policies = empty ? [] : POLICY_SEED.map((policy) => ({ ...policy }));
}

export const currentPacks = (): PolicyPack[] => packs;
export const currentPolicies = (): PolicyRow[] => policies;

/** Mirrors `PolicyStore.updatePolicy`: the owning pack's version moves with its policy. */
function touchPack(id: string): void {
  const pack = packs.find((entry) => entry.id === id);
  if (!pack) return;
  pack.version += 1;
  pack.updatedAt = new Date().toISOString();
}

/** Flips one policy; `undefined` for an unknown id, which the handler answers with a 404. */
export function togglePolicy(id: string, enabled: boolean): PolicyRow | undefined {
  const row = policies.find((policy) => policy.id === id);
  if (!row) return undefined;
  row.enabled = enabled;
  touchPack(row.packId);
  return row;
}

/** Flips a whole pack. The policies keep their own `enabled`; the pack gates them on top. */
export function togglePack(id: string, enabled: boolean): PolicyPack | undefined {
  const pack = packs.find((entry) => entry.id === id);
  if (!pack) return undefined;
  pack.enabled = enabled;
  pack.version += 1;
  pack.updatedAt = new Date().toISOString();
  return pack;
}
