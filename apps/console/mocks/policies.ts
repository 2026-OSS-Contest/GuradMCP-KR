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
// `warn_external_url_fetch` and `developer-relaxed` have no counterpart anywhere; they exist
// because the design needs a dry-run row and a disabled, empty pack to draw.

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

const POLICY_SEED: PolicyRow[] = [
  {
    id: "block_env_file_read",
    packId: "default",
    priority: 100,
    action: "block",
    severity: "critical",
    description: "Block reads of credential files",
    enabled: true,
    path: "policy-packs/default/policies/block-env-file-read.yaml"
  },
  {
    id: "mask_korean_phone",
    packId: "korean-pii",
    priority: 200,
    action: "mask_then_allow",
    severity: "high",
    description: "Mask Korean mobile phone numbers",
    enabled: true,
    path: "policy-packs/korean-pii/policies/mask-korean-pii-response.yaml"
  },
  {
    id: "approve_external_email",
    packId: "default",
    priority: 300,
    action: "require_approval",
    severity: "high",
    description: "Require approval for external email",
    enabled: true,
    path: "policy-packs/default/policies/require-approval-external-secret-email.yaml"
  },
  {
    // What a real control plane returns: the six fields `Policy` declares and nothing else. No
    // `enabled`, so the console cannot switch it; no source, so the YAML pane has none to show.
    id: "block_untrusted_injection_response",
    packId: "korean-pii",
    priority: 340,
    action: "block",
    severity: "critical",
    description: "Block high-risk prompt injection returned by an untrusted MCP server"
  },
  {
    // The design's dimmed last row: evaluating, acting on nothing, so it has no fired count.
    id: "warn_external_url_fetch",
    packId: "korean-pii",
    priority: 320,
    action: "mask_then_allow",
    severity: "medium",
    description: "Dry-run — measure how often external fetches would be flagged",
    enabled: false,
    dryRun: true,
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
  mask_korean_phone: `id: mask_korean_phone
pack: korean-pii
version: 1
description: Mask Korean mobile phone numbers on their way back to the agent
priority: 200
match:
  direction: response
  tool: '*'
  detections:
    any_of: [PII.PHONE]
action: mask_then_allow
severity: high
message: 응답에서 개인정보를 마스킹했습니다.`,
  approve_external_email: `id: approve_external_email
pack: default
version: 1
description: Hold external mail carrying secrets for a human decision
priority: 300
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
  warn_external_url_fetch: `id: warn_external_url_fetch
pack: korean-pii
version: 1
description: Dry-run — measure how often external fetches would be flagged
priority: 320
match:
  direction: request
  tool: fetch_url
action: mask_then_allow
severity: medium
enabled: false`
};

/**
 * What `GET /policies/{policyId}/stats` answers. The fired counts the table shows and the dry-run
 * panel's 가상 판정 are the same record read twice, which is how GMCP-80 describes the endpoint.
 */
const STATS: Record<string, PolicyStats> = {
  block_env_file_read: { policyId: "block_env_file_read", firedLast30d: 14 },
  mask_korean_phone: { policyId: "mask_korean_phone", firedLast30d: 212 },
  approve_external_email: { policyId: "approve_external_email", firedLast30d: 5 },
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
