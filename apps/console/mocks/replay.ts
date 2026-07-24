// SCR-301 Replay fixtures, reproducing the Figma frames: the session list, the #s-0712
// timeline, and the block event's detail (read_file, threat 92, two secret detections,
// chain verified #a3f9c1).

import type { EventDetail, SessionSummary, TimelineEvent, TimelineResponse } from "@/lib/api/types";

// A fixed clock keeps the timestamps matching the design ("14:02:41" etc.) rather than
// drifting with the wall clock, which matters when diffing against the export.
const DAY = "2026-07-04T";

export const SESSIONS: SessionSummary[] = [
  {
    id: "s-0712",
    startedAt: `${DAY}14:02:00+09:00`,
    live: true,
    eventCount: 18,
    verdicts: [
      { verdict: "block", count: 4 },
      { verdict: "warn", count: 4 }
    ]
  },
  {
    id: "s-0711",
    startedAt: `${DAY}11:38:00+09:00`,
    live: false,
    eventCount: 17,
    verdicts: [
      { verdict: "block", count: 2 },
      { verdict: "require_approval", count: 4 }
    ]
  },
  {
    id: "s-0710",
    startedAt: `${DAY}09:15:00+09:00`,
    live: false,
    eventCount: 16,
    verdicts: [
      { verdict: "warn", count: 4 },
      { verdict: "allow", count: 7 }
    ]
  }
];

/** The #s-0712 timeline exactly as the export lays it out (spec §5.3 no.3). */
const TIMELINE_0712: TimelineEvent[] = [
  { id: "e1", type: "user", at: `${DAY}14:02:12+09:00`, title: "README를 요약해줘" },
  {
    id: "e2",
    type: "agent",
    at: `${DAY}14:02:28+09:00`,
    title: "README 내 지시문 발견",
    subtitle: ".env 읽기 설정"
  },
  { id: "e3", type: "tool_call", at: `${DAY}14:02:30+09:00`, title: 'read_file(".env")' },
  {
    id: "e4",
    type: "verdict",
    at: `${DAY}14:02:41+09:00`,
    title: "차단",
    verdict: "block",
    policy: "block_env_file_read"
  },
  {
    id: "e5",
    type: "result",
    at: `${DAY}14:02:49+09:00`,
    title: "error반환 –",
    subtitle: "“GuardMCP 정책에 의해 차단되었습니다”"
  },
  {
    id: "e6",
    type: "agent",
    at: `${DAY}14:02:28+09:00`,
    title: "차단 응답 수신",
    subtitle: "작업 중단, 사용자에게 보고"
  }
];

/** Full detail for the block node — the hero of the SCR-301 right panel. */
const BLOCK_DETAIL: EventDetail = {
  id: "e4",
  sessionId: "s-0712",
  at: `${DAY}14:02:41+09:00`,
  verdict: "block",
  tool: "read_file",
  policies: ["block_env_file_read", "deny_secret_exfil"],
  threatScore: 92,
  detections: [
    { type: "SECRET", subtype: "OPENAI_KEY", confidence: 98 },
    { type: "SECRET", subtype: "GENERIC_PASSWORD", confidence: 92 }
  ],
  maskDiff: {
    before: "OPENAI_API_KEY=sk-dhjcfeas...\nKey=Real Text\nKey=Real Text",
    after: "OPENAI_API_KEY=SECRET_OPENAI\nKey=텍스트\nKey=텍스트"
  },
  chain: { status: "verified", hash: "a3f9c1" },
  canReveal: true
};

// Lighter detail for the non-verdict nodes: the panel shows the verdict/tool header and hides
// the sections that have no data (detections, mask diff). Enough for selection to feel real
// before GMCP-11 wires the timeline; the block node stays the rich one.
function plainDetail(event: TimelineEvent): EventDetail {
  return {
    id: event.id,
    sessionId: "s-0712",
    at: event.at,
    verdict: event.verdict ?? "allow",
    tool: event.title,
    policies: event.policy ? [event.policy] : [],
    threatScore: 0,
    detections: [],
    maskDiff: null,
    chain: { status: "verified", hash: "a3f9c1" },
    canReveal: false
  };
}

export function timelineOf(sessionId: string): TimelineResponse {
  // Only #s-0712 has a scripted timeline; other sessions return an empty rail for now.
  if (sessionId !== "s-0712") return { events: [], details: {} };
  const details: Record<string, EventDetail> = {};
  for (const event of TIMELINE_0712) details[event.id] = event.id === "e4" ? BLOCK_DETAIL : plainDetail(event);
  return { events: TIMELINE_0712, details };
}

/** The event the detail panel opens on: the block, per §5.3's block-detail focus. */
export const DEFAULT_SELECTED_ID = "e4";

// Read-only YAML shown in the Policy Chip popover (spec §3). Synthetic, keyed by policy id.
const POLICY_YAML: Record<string, string> = {
  block_env_file_read: `id: block_env_file_read
match:
  tool: read_file
  path: ["**/.env", "**/.env.*"]
action: block
severity: critical
message: "환경 파일 읽기는 정책으로 차단됩니다."`,
  deny_secret_exfil: `id: deny_secret_exfil
match:
  detections: [SECRET]
  direction: response
action: block
severity: high
message: "탐지된 시크릿의 외부 유출을 차단합니다."`
};

export function policyDetail(id: string): { id: string; yaml: string } {
  return {
    id,
    yaml: POLICY_YAML[id] ?? `id: ${id}\n# 이 정책의 정의를 찾지 못했습니다.`
  };
}
