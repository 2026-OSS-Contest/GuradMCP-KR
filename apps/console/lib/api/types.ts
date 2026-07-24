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

/** Right panel for a selected event (spec §5.3 no.4). */
export interface EventDetail {
  id: string;
  sessionId: string;
  at: string;
  verdict: Verdict;
  tool: string;
  /** Matching policies (Policy Chip list). */
  policies: string[];
  /** 0–100; shown red for a block. */
  threatScore: number;
  detections: Detection[];
  maskDiff: MaskDiff | null;
  chain: { status: ChainStatus; hash: string };
  /** Whether the reveal-original action is available to this operator (spec §5.3 no.5). */
  canReveal: boolean;
}

/** Policy Chip popover payload (spec §3): the read-only YAML behind a policy id. */
export interface PolicyDetail {
  id: string;
  yaml: string;
}

export interface SessionsResponse {
  sessions: SessionSummary[];
}

export interface TimelineResponse {
  events: TimelineEvent[];
  /** Full detail for each event id the panel can select. */
  details: Record<string, EventDetail>;
}
