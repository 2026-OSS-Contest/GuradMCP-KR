// Sample payloads for the mock API, reproducing the SCR-101 Figma frames so the screen can be
// diffed against the design. Values the screen cannot derive are literals straight from the
// design; server and tool counts are derived from the fixture below.

import type { McpServer, Overview, SecurityEvent } from "@/lib/api/types";
import { pendingCount } from "./approvals";

export const POLICY_PACKS = ["default", "korean-pii"];

export const SERVERS: McpServer[] = [
  {
    id: "file-server",
    name: "file_server",
    endpoint: "http://file-mcp:8801/sse",
    connected: true,
    trust: "limited",
    tools: [
      { name: "read_file", risk: "high", policies: ["block_env_file_read", "mask_secret_in_file", "audit_file_read"], snapshotChanged: false },
      { name: "write_file", risk: "medium", policies: ["deny_system_path_write"], snapshotChanged: true },
      { name: "list_directory", risk: "low", policies: ["audit_directory_list"], snapshotChanged: false }
    ]
  },
  {
    id: "mail-server",
    name: "mail_server",
    endpoint: "http://mail-mcp:8802/sse",
    connected: true,
    trust: "trusted",
    tools: [
      { name: "send_email", risk: "high", policies: ["approve_external_email_with_secret", "mask_kr_pii"], snapshotChanged: false },
      { name: "list_messages", risk: "low", policies: ["mask_kr_pii"], snapshotChanged: false },
      { name: "read_message", risk: "medium", policies: ["mask_kr_pii"], snapshotChanged: false },
      { name: "delete_message", risk: "medium", policies: [], snapshotChanged: false }
    ]
  },
  {
    id: "db-server",
    name: "db_server",
    endpoint: "http://db-mcp:8803/sse",
    connected: false,
    trust: "untrusted",
    tools: [
      { name: "db_query", risk: "high", policies: ["mask_kr_pii", "block_bulk_export"], snapshotChanged: false },
      { name: "db_execute", risk: "high", policies: ["block_bulk_export"], snapshotChanged: false },
      { name: "list_tables", risk: "low", policies: [], snapshotChanged: false },
      { name: "describe_table", risk: "low", policies: [], snapshotChanged: false }
    ]
  }
];

export function overviewOf(servers: McpServer[]): Overview {
  const disconnected = servers.filter((server) => !server.connected).length;
  return {
    // The gateway reports its own health; a single unreachable upstream is not the console's
    // cue to downgrade it. The design draws "보호 중" alongside a "1개 끊김" KPI for exactly
    // this case, and `degraded` is reserved for the gateway saying so.
    status: "protected",
    servers: { total: servers.length, disconnected },
    // Server-side aggregate in the real API — the inventory only lists the servers on screen.
    protectedTools: 17,
    policies: { active: 24, packs: POLICY_PACKS },
    blocked24h: 6,
    pendingApprovals: pendingCount()
  };
}

export const EMPTY_OVERVIEW: Overview = {
  status: "protected",
  servers: { total: 0, disconnected: 0 },
  protectedTools: 0,
  policies: { active: 24, packs: POLICY_PACKS },
  blocked24h: 0,
  pendingApprovals: 0
};

/** Ages are relative to request time so "방금 전" stays true however long the tab is open. */
const AGES_MS = [20_000, 60_000, 4 * 60_000, 6 * 60_000, 32 * 60_000, 60 * 60_000];

export function recentEvents(): SecurityEvent[] {
  const now = Date.now();
  const seed: Omit<SecurityEvent, "at">[] = [
    { id: "evt-6012", sessionId: "s-0712", verdict: "block", tool: "read_file", target: ".env" },
    { id: "evt-6011", sessionId: "s-0712", verdict: "require_approval", tool: "send_email", target: "external@example.com" },
    { id: "evt-6010", sessionId: "s-0712", verdict: "warn", tool: "fetch_url", target: "외부 URL" },
    { id: "evt-6009", sessionId: "s-0711", verdict: "allow", tool: "list_directory" },
    { id: "evt-6008", sessionId: "s-0711", verdict: "block", tool: "read_file", target: "id_rsa" },
    { id: "evt-6007", sessionId: "s-0710", verdict: "allow", tool: "db_query" }
  ];
  return seed.map((event, index) => ({ ...event, at: new Date(now - AGES_MS[index]).toISOString() }));
}

// Rotated through by the SSE stream so each pushed event is a distinct, fresh-looking row.
const LIVE_SEED: Omit<SecurityEvent, "at" | "id">[] = [
  { sessionId: "s-0712", verdict: "block", tool: "read_file", target: "credentials.json" },
  { sessionId: "s-0712", verdict: "warn", tool: "fetch_url", target: "pastebin.com" },
  { sessionId: "s-0713", verdict: "require_approval", tool: "send_email", target: "ceo@partner.example" },
  { sessionId: "s-0713", verdict: "allow", tool: "list_directory", target: "/etc" }
];

/** A new event for the live stream (spec §5.1 no.5), stamped now so it sorts to the top. */
export function liveEvent(seq: number): SecurityEvent {
  const base = LIVE_SEED[seq % LIVE_SEED.length];
  return { ...base, id: `evt-live-${seq}`, at: new Date().toISOString() };
}
