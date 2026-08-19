// Console API contracts (UI specification §6.1–6.2).
//
// `/events/recent` does not exist on the control plane yet, and `/overview` currently returns a
// different shape. These types describe what the screens need; the MSW handlers in `mocks/`
// serve exactly this, so wiring the real backend needs no UI change. `/servers` (GET and PUT
// .../trust) was implemented in GMCP-64 (FR-GW-02) to match this file's `McpServer` shape
// exactly. `tools[].snapshotStatus` was populated for real in GMCP-65 (FR-GW-03); `risk` and
// `policies` are still placeholders on the real backend — no tool-level risk scoring or
// policy-to-tool binding exists yet (see `ServerRegistryStore.kt`'s `ToolSummary` doc comment).

export type Verdict = "allow" | "warn" | "require_approval" | "block";
export type TrustLevel = "trusted" | "limited" | "untrusted";
export type RiskLevel = "high" | "medium" | "low";

/** Status bar indicator (spec §4.1 no.3). `degraded` = gateway up, some upstreams down. */
export type GatewayStatus = "protected" | "degraded" | "disconnected";

export interface Overview {
  status: GatewayStatus;
  servers: { total: number; disconnected: number };
  protectedTools: number;
  policies: { active: number; packs: string[] };
  blocked24h: number;
  pendingApprovals: number;
}

/** FR-GW-03 §6.1. `unapproved`: no tool ever had its definition approved as a baseline.
 *  `drift_acknowledged`: every pending diff for this tool was dismissed via `/acknowledge`,
 *  but the approved snapshot itself was never updated (spec §6.3 keeps those two operations
 *  separate) — the tool is still running on a definition the baseline doesn't cover, so this
 *  is deliberately distinct from `in_sync`, not folded into it. */
export type SnapshotState = "in_sync" | "drift_detected" | "drift_acknowledged" | "unapproved";

/** FR-GW-03 §6.1 `snapshotStatus`. `GET /servers` (GMCP-65) reports this for real now —
 *  see `services/control-plane/.../api/ServerController.kt`'s `toolInventory`. */
export interface SnapshotStatus {
  state: SnapshotState;
  snapshotCapturedAt: string | null;
  lastCheckedAt: string | null;
  pendingDiffCount: number;
  latestDiffId: string | null;
}

export interface ToolEntry {
  name: string;
  risk: RiskLevel;
  /** Policy ids applied to this tool. The first is shown as a chip, the rest as "외 N". */
  policies: string[];
  snapshotStatus: SnapshotStatus;
}

/** FR-GW-03 §6.2/§6.3. `before`/`after` are `null` only for `tool_added`/`tool_removed`
 *  respectively; otherwise `{ description }` or `{ description, inputSchema }` depending on
 *  which field(s) changed — see `packages/gateway/src/tool-snapshot.ts`'s `ToolDiffSide`. */
export type ToolDiffType = "tool_added" | "tool_removed" | "description_changed" | "schema_changed";

export interface ToolDiffSide {
  description?: string;
  inputSchema?: unknown;
}

export interface ToolDefinitionDiff {
  id: string;
  diffType: ToolDiffType;
  before: ToolDiffSide | null;
  after: ToolDiffSide | null;
  detectedAt: string;
  acknowledged: boolean;
}

export interface ToolDiffsResponse {
  toolName: string;
  diffs: ToolDefinitionDiff[];
}

export interface McpServer {
  id: string;
  name: string;
  connected: boolean;
  trust: TrustLevel;
  tools: ToolEntry[];
  /** Where the gateway reaches it — the SCR-501 server table's second column. */
  endpoint?: string;
}

export interface SecurityEvent {
  id: string;
  /** Deep-link target: /replay/{sessionId}?event={id} (spec §3). */
  sessionId: string;
  verdict: Verdict;
  tool: string;
  /** Short subject shown next to the tool name — a path, host or recipient. */
  target?: string;
  /** ISO 8601. */
  at: string;
}

export interface ServersResponse {
  servers: McpServer[];
}

/** Trust-grade order (FR-GW-02 §5.1): `untrusted < limited < trusted`. */
export const TRUST_RANK: Record<TrustLevel, number> = {
  untrusted: 0,
  limited: 1,
  trusted: 2,
};

export interface ServerTrustChangeRequest {
  trustLevel: TrustLevel;
  confirmed?: boolean;
}

/** `PUT /servers/{id}/trust` 200 response — the same lean shape `GET /servers` lists. */
export type ServerTrustChangeResult = Omit<McpServer, "tools">;

/** Standard control-plane error body (`services/control-plane/.../api/ApiError.kt`). */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, string>;
}

/** `details` on the 409 `upgrade_requires_confirmation` response (FR-GW-02 §5.1). */
export interface TrustUpgradeConflictDetails {
  fromTrust: TrustLevel;
  toTrust: TrustLevel;
  affectedPolicyCount: string;
}

export interface RecentEventsResponse {
  events: SecurityEvent[];
}

// ── SCR-301 Replay (spec §5.3) ──────────────────────────────────────────────
// Shared by the timeline (SCR-301 centre, GMCP-11) and the event detail panel
// (SCR-301 right, GMCP-34). `GET /sessions` and `GET /sessions/{id}/timeline`.

/** Left column: one row per session, with a verdict tally and the live marker. */
export interface SessionSummary {
  id: string;
  /** ISO 8601; the list shows the time part. */
  startedAt: string;
  live: boolean;
  eventCount: number;
  /** Non-zero verdict counts, in the order the design stacks the small badges. */
  verdicts: { verdict: Verdict; count: number }[];
}

/** Timeline node kinds and their markers (spec §5.3 no.3). */
export type TimelineNodeType =
  | "user"
  | "agent"
  | "tool_call"
  | "verdict"
  | "result";

/** One node on the Timeline Rail. `detailId` links to its right-panel detail. */
export interface TimelineEvent {
  id: string;
  type: TimelineNodeType;
  at: string;
  /** Primary line (e.g. "README를 요약해줘", `read_file(".env")`). */
  title: string;
  /** Optional second line shown under the title on richer nodes. */
  subtitle?: string;
  /** Present on `verdict` nodes; colours the marker and shows the badge. */
  verdict?: Verdict;
  /** The one policy id a verdict node chips inline on the rail. */
  policy?: string;
}

/** A single PII/secret/injection finding (detection list, spec §5.3 no.4③). */
export interface Detection {
  /** Top-level tag, e.g. "SECRET", "PHONE". */
  type: string;
  subtype: string;
  /** 0–100. */
  confidence: number;
}

/** Mask Diff View (spec §5.3 no.4④): the text before and after masking. */
export interface MaskDiff {
  before: string;
  after: string;
}

export type ChainStatus = "verified" | "failed";

/**
 * A run of content: plain text, the masked token that replaced a detection (rendered as a chip,
 * e.g. PHONE, BANK_ACCOUNT), or — on the raw side of the reveal modal — the value that token
 * stands in for. 기획서 10.4 draws that one with the rule and the tint it
 * calls "밑줄+틴트 하이라이트", so a reader sees at a glance which lines the masking touched.
 */
export type ContentPart = { text: string } | { mask: string } | { secret: string };

/** One numbered line of masked content in the input/return sections and the reveal modal. */
export interface ContentLine {
  no: string;
  parts: ContentPart[];
}

/**
 * The direction verdict a tool-call / tool-result node carries. Which direction it is (요청 /
 * 응답 방향 판정) follows from the node kind, so the heading stays in the message catalogs
 * rather than riding along in the data.
 */
export interface DirectionVerdict {
  verdict: Verdict;
  policy: string;
  /** "외 N" when more than one policy matched. */
  morePolicies?: number;
}

/**
 * Reveal-original payload (spec §5.3 no.5, `POST /events/{id}/reveal`): the raw source next to
 * its masked form, shown in the reveal modal. Loaded only after the operator confirms.
 */
export interface RevealContent {
  /** Source line, e.g. "e-000  get_log  #C-20260712-142". */
  source: string;
  caseId: string;
  /** Numbered like `masked`, so the two columns are read line against line. */
  raw: ContentLine[];
  masked: ContentLine[];
}

/**
 * Right panel for a selected event (spec §5.3 no.4). The header (verdict, tool) is always
 * present; the remaining sections are node-type specific, so a user, agent, tool-call, verdict
 * or result event each renders a different body. Unset sections fold away.
 */
export interface EventDetail {
  id: string;
  sessionId: string;
  at: string;
  kind: TimelineNodeType;
  verdict: Verdict;
  tool: string;

  // Verdict node (§5.3 no.4).
  policies?: string[];
  threatScore?: number;
  detections?: Detection[];
  maskDiff?: MaskDiff | null;
  chain?: { status: ChainStatus; hash: string };

  // Agent node: the agent's own summary of what it decided.
  summary?: string;
  // User-input / tool-result node: numbered, masked content.
  body?: ContentLine[];
  // Tool-call node: the target and the JSON arguments.
  call?: { target: string; argsCount: number; argsJson: string };
  /**
   * FR-SEC-04 (GMCP-73): the path-like arg (path/file_path/filename), after the
   * gateway's normalization pipeline (URL-decode, NFKC, null-byte truncation,
   * `~`/`$HOME` expansion, `.`/`..` resolution, lowercase). Lets the operator
   * see the raw → normalized → matched-policy trail across the tool-call node's
   * args and its `direction.policy`. GuardEvent carries this on the live SSE
   * stream, but the GMCP-28 Replay wire contract's TimelineNode does not (see
   * below), so it stays undefined for Replay until that contract adds it.
   */
  normalizedPath?: string;
  // Tool-call / tool-result node: the direction verdict.
  direction?: DirectionVerdict;

  /**
   * GMCP-84 §8.2: whether this event has a stored raw payload at all (`hasRawPayload` off the
   * wire). Distinct from `canReveal`: this event may have one but the current operator may lack
   * `events:reveal` — the panel renders three states off these two fields (no permission: button
   * hidden; permission but not stored: disabled + tooltip; both: active), not one.
   */
  hasRawPayload?: boolean;
  /** Whether the reveal-original action is available to this operator (spec §5.3 no.5) —
   *  `hasRawPayload && <this build carries an operator identity>` (`hasOperatorPermissions()`). */
  canReveal?: boolean;
  /** Present when canReveal — the raw/masked content for the reveal modal. */
  reveal?: RevealContent;
}

/** Policy Chip popover payload (spec §3): the read-only YAML behind a policy id. */
export interface PolicyDetail {
  id: string;
  yaml: string;
}

export interface SessionsResponse {
  sessions: SessionSummary[];
}

// ── GMCP-28 backend wire contract ───────────────────────────────────────────
// The actual shape services/control-plane returns for GET /sessions, GET /sessions/{id}/timeline
// and GET /events/{id} (docs/task-docs/GMCP-28/replay-api-spec.md). Distinct from the UI-facing
// types above: those describe what the SCR-301 components render (SessionSummary, TimelineEvent,
// EventDetail); these describe what the wire actually carries. `lib/api/replay-adapter.ts`
// converts one into the other, so the components above never see this shape directly.
//
// The API's `detail` (matched policies, detections, mask-diff reference, hash chain) is only
// ever populated on VERDICT nodes; toolName/direction/argsDigest only on TOOL_CALL nodes; every
// node still carries an explicit `detail: null` otherwise (never omitted).
//
// Fields the existing UI types ask for that this API does not provide — raw/masked body text,
// real tool-call arguments (only a `sha256:` digest is ever returned, by design), the FR-SEC-04
// normalized path (GMCP-73), and a verdict attached to a TOOL_CALL/RESULT node specifically (only
// VERDICT nodes carry one) — have no source here. The adapter leaves EventDetail's
// `body`/`call`/`normalizedPath`/`direction` undefined for now; the corresponding panel sections
// simply do not render until those are backed by real endpoints.

export type ApiTimelineNodeType = "USER_INPUT" | "AGENT_STEP" | "TOOL_CALL" | "VERDICT" | "RESULT";
export type ApiToolCallDirection = "req" | "res";
/**
 * `"unknown"` means the session has no stored hash to verify against, so neither
 * "verified" nor "failed" can be claimed — sessions projected from ingested audit
 * events report it until GMCP-83 persists the chain. Treating it as verified is the
 * fabricated-badge failure `toEventDetailFromLookup` already guards against.
 */
export type ApiChainStatus = "valid" | "broken" | "unknown";

export interface ApiSpan {
  start: number;
  end: number;
}

export interface ApiDetection {
  /** PII | SECRET | INJ. */
  type: string;
  subtype: string;
  span: ApiSpan;
  /** 0–1 (note: the UI-facing `Detection.confidence` above is 0–100). */
  confidence: number;
  /** Always the masked form; the raw match is never returned by this API. */
  maskedAs: string;
}

export interface ApiVerdictDetail {
  matchedPolicyIds: string[];
  detections: ApiDetection[];
  /** URL the Mask Diff View fetches separately (out of scope: GET /events/{id}/mask-diff). */
  maskDiffRef: string;
  /**
   * The diff itself, inlined. GET /events/{id}/mask-diff is not in the 화면설계서 6.2 API list
   * and nothing implements it, so `maskDiffRef` points at a route no client can call — which is
   * why the panel's Mask Diff section never rendered (GMCP-115 A-1). Optional and mock-supplied
   * per AGENTS.md: the control plane omits it and the section simply folds away.
   */
  maskDiff?: { before: string; after: string } | null;
  hash: string;
  /** Empty string for the first VERDICT node in a session (chain genesis). */
  prevHash: string;
}

export interface ApiTimelineNode {
  eventId: string;
  type: ApiTimelineNodeType;
  ts: string;
  summary: string;
  toolName?: string;
  direction?: ApiToolCallDirection;
  argsDigest?: string;
  verdict?: Verdict;
  riskScore?: number;
  detail: ApiVerdictDetail | null;
  /**
   * GMCP-84 §8.3: whether this event has a stored, revealable raw payload — real, not
   * mock-supplied enrichment, unlike the fields below. Only ever true for a VERDICT node backed
   * by a real ingested GuardEvent with a non-null `raw_payload_ref`; absent/false everywhere else
   * (seeded demo sessions, non-VERDICT nodes).
   */
  hasRawPayload?: boolean;

  // The four below back the node-type-specific panel sections the design shows (frames
  // `…-사용자-입력-단계`, `…-agent-단계`, `…-tool-call-단계`, `…-tool-결과-단계`) and the GMCP-28
  // contract has no field for — it carries only a `sha256:` args digest, never the arguments,
  // the content or the per-direction verdict. Without them every node but VERDICT rendered a
  // bare header (GMCP-115 C-3). Optional and mock-supplied per AGENTS.md: the control plane
  // omits them and each section folds away.

  /** AGENT_STEP: the agent's own report of what it decided. */
  agentSummary?: string;
  /** USER_INPUT / RESULT: the numbered, already-masked content. */
  content?: ContentLine[];
  /** TOOL_CALL: the arguments as sent. `argsDigest` above is all the real API returns. */
  argsJson?: string;
  /** TOOL_CALL / RESULT: the verdict for that direction alone, distinct from the VERDICT node. */
  directionVerdict?: { verdict: Verdict; policyIds: string[] };
}

export interface ApiSessionSummary {
  sessionId: string;
  agentLabel: string;
  startedAt: string;
  endedAt: string | null;
  isLive: boolean;
  eventCount: number;
  /** Fixed keys allow/warn/require_approval/block, always all four. */
  verdictSummary: Record<Verdict, number>;
}

export interface ApiSessionsResponse {
  items: ApiSessionSummary[];
  nextCursor: string | null;
}

export interface ApiSessionTimelineResponse {
  sessionId: string;
  agentLabel: string;
  startedAt: string;
  isLive: boolean;
  chainStatus: ApiChainStatus;
  /** First eventId whose hash chain check failed; present only when chainStatus is "broken". */
  brokenAt?: string;
  nodes: ApiTimelineNode[];
  nextCursor: string | null;
}

/** GET /events/{id}: the same node schema as a timeline entry, with `sessionId` added. */
export interface ApiEventLookupResponse extends ApiTimelineNode {
  sessionId: string;
}

// ── SCR-201 Attack Lab (spec §5.2) ──────────────────────────────────────────
// `GET /attacklab/scenarios` and `POST /attacklab/run/{id}`. The control plane accepts the run
// today but only records it as queued — executing it and returning the calls below is the Attack
// Lab runner's job (GMCP-55), so the mock serves a completed run in the meantime.

/** Guard off (취약) versus guard on (보호) — the two panes the run is compared across. */
export type AttackRunMode = "unguarded" | "guarded";

export interface AttackScenario {
  /** `T-01` … `T-08`. */
  id: string;
  title: string;
  /** Not runnable yet — the picker lists it as 준비 중 and refuses to select it. */
  available: boolean;
}

export interface AttackScenariosResponse {
  scenarios: AttackScenario[];
}

/** One line of the payload an unguarded call leaked, e.g. `OPENAI_API_KEY = sk-…`. */
export interface PayloadLine {
  key: string;
  value: string;
  /** Rendered as an exposed secret — the point the unguarded pane is making. */
  secret?: boolean;
}

/** One Tool Call Card in a run pane (spec §5.2 no.3). */
export interface ToolCallCard {
  id: string;
  at: string;
  tool: string;
  /** Argument shown beside the tool name, e.g. `".env"` or `to: attacker@evilexample.com`. */
  args?: string;
  /** Unguarded outcome line, e.g. `실행됨 · 토큰 노출`. */
  note?: string;
  /** What the call leaked, shown as a code block under the note. */
  payload?: PayloadLine[];
  /** Guarded verdict row: the badge, the deciding policy and the risk score. */
  verdict?: Verdict;
  policy?: string;
  riskScore?: number;
  /** Never called because an earlier call was blocked — drawn dashed and dimmed. */
  skippedReason?: string;
}

/** A row of the 실시간 스트림 table under the panes. */
export interface StreamRow {
  id: string;
  at: string;
  tool: string;
  verdict: Verdict;
  /** Secondary subject shown next to the verdict, e.g. `readme.md`. */
  target?: string;
  /** 위험 점수 (SSE). */
  risk: number;
}

/** Verdict tallies for the shared result strip. */
export interface RunSummary {
  block: number;
  warn: number;
  require_approval: number;
  allow: number;
}

/** A finished run of one scenario in one mode. */
export interface AttackRun {
  runId: string;
  scenarioId: string;
  mode: AttackRunMode;
  calls: ToolCallCard[];
  summary: RunSummary;
  stream: StreamRow[];
  /** Recorded session, for the Replay deep link on the summary strip. */
  sessionId: string;
}

// ── SCR-401 Detector (spec §5.4) ────────────────────────────────────────────
// `POST /detect/preview`, which the control plane already serves. Its own vocabulary is the
// OpenAPI `GuardAction`/`Severity`, so these mirror the wire format rather than the UI's
// `Verdict`; `toVerdict()` in `lib/verdict.ts` bridges the two.

/**
 * The control plane's verdict vocabulary (`domain/GuardAction.kt`), which is wider than the UI's
 * four. Both `warn` and `mask_then_allow` land on the UI's `warn`: the DSL separates recording a
 * finding from rewriting the payload, and the rail has one colour for "went through, with
 * something on the record". `warn` was missing here until GMCP-117 — a policy carrying it (the
 * shipped `warn_injection_request` does) fell through `toVerdict`'s default and drew as 허용.
 */
export type GuardAction = "allow" | "warn" | "mask_then_allow" | "require_approval" | "block";
export type Severity = "low" | "medium" | "high" | "critical";

/** Which side of a tool call the text came from — the policies differ by direction. */
export type DetectDirection = "request" | "response";

export interface DetectionFinding {
  policyId: string;
  action: GuardAction;
  severity: Severity;
  matchedText: string;
  /** Character offsets into the submitted text, which drive the inline highlight. */
  start: number;
  end: number;
  /**
   * Detector label shown as the tag and substituted into the masked text (PHONE, RRN, SECRET).
   * The control plane does not report one yet, so the screen derives it from `policyId`.
   */
  type?: string;
  /** 0–100. Absent until the control plane reports it, and then simply not shown. */
  confidence?: number;
}

export interface DetectionPreview {
  verdict: GuardAction;
  findings: DetectionFinding[];
  /** The text with every finding replaced — the right-hand 마스킹 결과 pane. */
  maskedText: string;
}

// ── SCR-402 Approval Console (spec §5.6) ────────────────────────────────────
// `GET /approvals` and `POST /approvals/{id}/decision`, both already served by the control
// plane. Its own vocabulary is used on the wire; the enrichment the design draws — the risk
// tags, the threat score, the mask preview — is optional because the control plane does not
// report it yet, and the card simply leaves out whatever is missing.

export type ApprovalStatus = "pending" | "approved" | "approved_masked" | "blocked" | "expired";

/** The operator's three choices (spec §5.6): 차단 / 마스킹 후 승인 / 그대로 승인. */
export type ApprovalDecision = "block" | "approve_masked" | "approve";

/** A run of the 마스킹 전 (Raw) pane: plain text, or the value masking would replace. */
export type RawPart = { text: string } | { sensitive: string };

/**
 * One numbered line of the Raw pane. Deliberately not `ContentLine`: there a `mask` part carries
 * the label that stands in for a value (`PHONE`), whereas this pane has to show the value itself.
 * Sharing the type would mean the same field meant opposite things depending on which pane read
 * it, and a backend filling it per the documented contract would render `PHONE` as the original.
 */
export interface RawLine {
  no: string;
  parts: RawPart[];
}

export interface Approval {
  id: string;
  sessionId: string;
  status: ApprovalStatus;
  toolName: string;
  /** Call arguments; the card headlines the first as the call's subject. */
  arguments: Record<string, string>;
  riskReason: string;
  policyId?: string | null;
  requestedAt: string;
  /** When the gateway gives up and fails closed — what the countdown counts down to. */
  expiresAt: string;
  decision?: ApprovalDecision | null;
  decidedBy?: string | null;
  decidedAt?: string | null;

  /** `SECRET 1건`, `INJECTION 1건` — the evidence chips beside the reason. */
  riskTags?: { type: string; count: number }[];
  /** 0–100, shown beside the tags. */
  threatScore?: number;
  /** The 마스킹 미리보기 panes: the values that would go out, beside what would replace them. */
  maskPreview?: { raw: RawLine[]; masked: ContentLine[] };
}

export interface TimelineResponse {
  events: TimelineEvent[];
  /** Full detail for each event id the panel can select. */
  details: Record<string, EventDetail>;
}

// ── SCR-501 Settings (spec §5.7, GMCP-88/GMCP-68) ───────────────────────────
// Server trust is real: FR-GW-02 shipped `PUT /servers/{id}/trust`, and this screen calls it
// through `putServerTrust` rather than the shape an earlier reading here invented.
//
// `GET`/`PUT /settings` is real too now: GMCP-68's `SettingsController` serves the whole shape
// below (`services/control-plane/src/main/kotlin/kr/guardmcp/controlplane/api/SettingsController.kt`).

/** What the gateway does when it cannot reach its own guard (GMCP-68). */
export type FailMode = "fail_closed" | "fail_open";

export interface GatewaySettings {
  failMode: FailMode;
  /**
   * Whether the audit log keeps the raw text beside the masked form. Off by default: turning it
   * on means the console starts storing exactly what it exists to redact, so the screen asks
   * (GMCP-84 §8.1's notice modal) before it goes through, and the control plane re-enforces that
   * gate server-side via `acknowledgedNotice` on `SettingsUpdate` (§6.2).
   */
  rawPayloadStorageEnabled: boolean;
  /** Last time it was turned on, and by whom (GMCP-84 §5.4) — `null` until the first time. */
  rawPayloadStorageEnabledAt?: string | null;
  rawPayloadStorageEnabledBy?: string | null;
  locale: "ko" | "en";
  /** Seconds a held call waits before the gateway fails it closed. The design's default is 120. */
  approvalTimeoutSeconds: number;
  /**
   * Whether the operator ticked "위험을 이해했습니다" the last time `failMode` became `fail_open`
   * (GMCP-68 REQ-08). Reported back by the control plane; the console never needs to read it —
   * it exists so `SettingsUpdate` can carry it on the one write that requires it.
   */
  riskAcknowledged?: boolean;
  /**
   * `PUT` response only (GMCP-84 §6.2): present when `rawPayloadStorageEnabled` just went
   * true→false, explaining that existing stored payloads are not deleted by this call. Never
   * returned by `GET`, and never sent on a request.
   */
  note?: string;
}

/**
 * `PUT /settings` — every field independent, so one control never resends another's value.
 * `riskAcknowledged: true` must ride along with `failMode: "fail_open"` (GMCP-68 REQ-08), and
 * `acknowledgedNotice: true` must ride along with `rawPayloadStorageEnabled: true` on the
 * false→true transition (GMCP-84 §6.2) — the control plane 400s/422s otherwise, regardless of
 * what the console's own dialog already gated.
 */
export type SettingsUpdate = Partial<GatewaySettings> & { acknowledgedNotice?: boolean };

// ── SCR-302 Policy Builder (spec §5.5, FR-POL-02/04) ────────────────────────
// `GET /policy-packs`, `GET /policies`, `PUT /policy-packs/{packId}` and `PUT /policies/{policyId}`
// are all served by the control plane today (`PolicyController`). Both GETs answer with a bare
// array rather than an envelope, and they speak the same `GuardAction`/`Severity` vocabulary as
// the detector — not the wider one the YAML DSL accepts, which has `warn` and `info` besides.
//
// The fields marked optional below are what the design draws and the control plane does not
// report. They are enrichment, exactly as on SCR-402: present under the mock, absent against a
// real gateway, and every one of them degrades to something the screen can still render.

export interface PolicyPack {
  id: string;
  /** A write counter the control plane bumps, not a semver string. */
  version: number;
  enabled: boolean;
  description: string;
  /** ISO-8601. Bumped alongside `version` on every write, including a policy's. */
  updatedAt: string;

  /**
   * Packs this one extends, which is what indents the tree. The control plane's `PolicyPack`
   * has no such field, so without it the tree renders flat — correct, just less informative.
   */
  extends?: string[];
}

export interface PolicyRow {
  id: string;
  packId: string;
  priority: number;
  action: GuardAction;
  severity: Severity;
  description: string;

  /**
   * Whether the policy is live. **The control plane has no per-policy enable/disable**:
   * `PolicyUpdateRequest` takes `action`, `severity` and `priority` and nothing else, and only
   * a *pack* can be switched off. The design draws a per-row toggle regardless, so the field is
   * optional and the screen treats a missing value as enabled.
   */
  enabled?: boolean;
  /** Evaluated but acting on nothing (GMCP-77). No DSL field and no endpoint reports it yet. */
  dryRun?: boolean;
  /** Repo-relative path of the file defining it, shown as the YAML pane's caption. */
  path?: string;
}


/**
 * `GET /policies/{policyId}/stats` — how often a policy actually fired, and what it *would* have
 * decided while in dry-run. GMCP-80 owns the endpoint and it is not built yet, so the mock is
 * the only server; the path and shape are the ones that ticket names.
 *
 * Both of the table's counts come from here: the 30-day column and the dry-run panel beneath the
 * YAML are two readings of the same record.
 */
export interface PolicyStats {
  policyId: string;
  /** Times it fired over the window; `null` when it never has — the table's "–". */
  firedLast30d: number | null;
  /** Present only while the policy is in dry-run: the verdicts it would have produced. */
  dryRun?: { wouldFire: number; windowDays: number };
}


// ── Benchmark (GMCP-61, SCR-601) ─────────────────────────────────────────────
// `attack-lab/benchmark/run.ts` already writes exactly this report; these types are that file's
// output, read back. Two endpoints serve it and neither exists on the control plane yet —
// GET /benchmark/report and GET /benchmark/samples are the two the console needs built.
//
// The split matters: the report carries per-item results for the 40 scenarios and the 29 policy
// fixtures, but for the 176 dataset samples it carries only aggregates (recall, fpr, and a list
// of ids that were missed). A screen that ticks each sample as it goes therefore cannot get that
// verdict from the report — which is why `/samples` returns each sample already judged.

export interface BenchmarkMetrics {
  recall: number;
  fpr: number;
  precision: number;
  p95Ms: number;
  averageMs: number;
  payloadBytes: number;
  blockRate: number;
  scenarioPassRate: number;
  fixturePassRate: number;
  fixtureCoverageRate: number;
  samples: number;
  positives: number;
  negatives: number;
  labeledTypeCount: number;
}

/** The pass marks from `docs/benchmark-gate.md` 12.2. A metric is read against its own. */
export interface BenchmarkThresholds {
  recall: number;
  fpr: number;
  p95Ms: number;
  blockRate: number;
  scenarioPassRate: number;
  fixturePassRate: number;
  fixtureCoverageRate: number;
  koreanServiceTokenRecall: number;
  koreanServiceTokenFpr: number;
  highEntropyRecall: number;
  highEntropyFpr: number;
}

export interface BenchmarkTypeRecall {
  type: string;
  total: number;
  detected: number;
  recall: number;
}

/** A dataset measured on its own: the Korean service tokens and the high-entropy secrets. */
export interface BenchmarkDatasetResult {
  samples: number;
  positives: number;
  negatives: number;
  recall: number;
  fpr: number;
  /** Ids of the labelled positives this run failed to detect. */
  misses: string[];
}

/** What the format checks are worth: the same negatives measured with them off, then on. */
export interface BenchmarkValidationImpact {
  fprWithoutValidation: number;
  fprWithValidation: number;
  falsePositivesPrevented: number;
  fprReduction: number;
}

export interface BenchmarkScenario {
  /** The probe id from `attack-lab/scenarios/threats.json` — `T-…` attacks, `B-…` benign. */
  id: string;
  passed: boolean;
  expectedBlocked: boolean;
  actualBlocked: boolean;
  /**
   * The probe itself, and the threat it belongs to. The report the runner writes carries neither:
   * both live in `attack-lab/scenarios/{threats,catalog}.json`, so the endpoint has to join them
   * before answering. Optional because a report read straight off disk will not have them, and
   * the screen then shows the id alone.
   */
  text?: string;
  /** Tool arguments the probe is sent with, where it has any. */
  args?: Record<string, string>;
  /** Only the catalogued families T-01…T-09; the later probes have no catalog entry. */
  threat?: { id: string; name: string; summary: string; owasp: string[] };
}

export interface BenchmarkFixture {
  id: string;
  passed: boolean;
  coverage: { policy_id: string; expectation: string };
  expected: { action: string; matched_policy_ids: string[] };
  actual: { action: string; matched_policy_ids: string[] };
}

export interface BenchmarkFixtureCoverage {
  policyId: string;
  positive: boolean;
  negative: boolean;
}

export interface BenchmarkReport {
  generatedAt: string;
  metrics: BenchmarkMetrics;
  thresholds: BenchmarkThresholds;
  perTypeRecall: BenchmarkTypeRecall[];
  koreanServiceTokens: BenchmarkDatasetResult;
  highEntropySecrets: BenchmarkDatasetResult;
  validationImpact: BenchmarkValidationImpact;
  scenarios: BenchmarkScenario[];
  fixtures: BenchmarkFixture[];
  fixtureCoverage: BenchmarkFixtureCoverage[];
  /** Every threshold met. The runner exits non-zero when this is false. */
  passed: boolean;
}

/** Which dataset a sample came from — the four under `attack-lab/datasets/`. */
export type BenchmarkSampleGroup = "pii" | "injection" | "serviceToken" | "entropy";

export interface BenchmarkSample {
  id: string;
  group: BenchmarkSampleGroup;
  /** True when the sample is a labelled positive: something the detector is meant to catch. */
  label: boolean;
  /** The label's own subdivision — a PII type, an injection subtype, a credential name. */
  kind: string | null;
  text: string;
  /** Whether this run caught it. Always false for a negative, which is nothing to catch. */
  detected: boolean;
}

export interface BenchmarkSamplesResponse {
  samples: BenchmarkSample[];
}
