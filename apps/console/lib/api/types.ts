// Console API contracts (UI specification §6.1–6.2).
//
// `/servers` and `/events/recent` do not exist on the control plane yet, and `/overview`
// currently returns a different shape. These types describe what the screens need; the MSW
// handlers in `mocks/` serve exactly this, so wiring the real backend needs no UI change.

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

export interface ToolEntry {
  name: string;
  risk: RiskLevel;
  /** Policy ids applied to this tool. The first is shown as a chip, the rest as "외 N". */
  policies: string[];
  /** FR-GW-03: the tool description differs from the one approved at first sight. */
  snapshotChanged: boolean;
}

export interface McpServer {
  id: string;
  name: string;
  connected: boolean;
  trust: TrustLevel;
  tools: ToolEntry[];
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
export type TimelineNodeType = "user" | "agent" | "tool_call" | "verdict" | "result";

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

/** A run of text, or a masked token rendered as a chip (e.g. PHONE, BANK_ACCOUNT). */
export type ContentPart = { text: string } | { mask: string };

/** One numbered line of masked content in the input/return sections and the reveal modal. */
export interface ContentLine {
  no: string;
  parts: ContentPart[];
}

/** The direction verdict a tool-call / tool-result node carries (요청/응답 방향 판정). */
export interface DirectionVerdict {
  heading: string;
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
  raw: string;
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
  summary?: { heading: string; text: string };
  // User-input / tool-result node: numbered, masked content.
  body?: { heading: string; lines: ContentLine[] };
  // Tool-call node: the target and the JSON arguments.
  call?: { target: string; argsCount: number; argsJson: string };
  // Tool-call / tool-result node: the direction verdict.
  direction?: DirectionVerdict;

  /** Whether the reveal-original action is available to this operator (spec §5.3 no.5). */
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

/** The control plane's verdict vocabulary. `mask_then_allow` is the UI's `warn`. */
export type GuardAction = "allow" | "mask_then_allow" | "require_approval" | "block";
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

export interface TimelineResponse {
  events: TimelineEvent[];
  /** Full detail for each event id the panel can select. */
  details: Record<string, EventDetail>;
}
