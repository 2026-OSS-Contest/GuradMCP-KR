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
