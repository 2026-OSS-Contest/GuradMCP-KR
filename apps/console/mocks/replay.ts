// SCR-301 Replay fixtures, reproducing the Figma frames: the session list and the #s-0712
// timeline. These are shaped as the real GMCP-28 wire contract (`Api*` types) — the same JSON
// services/control-plane returns — so `lib/api/replay-adapter.ts` runs identically against the
// mock and a real backend, and dev mode never drifts from what prod actually serves.

import type {
  ApiEventLookupResponse,
  ApiSessionSummary,
  ApiSessionTimelineResponse,
  ApiTimelineNode,
  ContentLine,
  RevealContent
} from "@/lib/api/types";

// A fixed clock keeps the timestamps matching the design ("14:02:41" etc.).
const DAY = "2026-07-04T";

export const SESSIONS: ApiSessionSummary[] = [
  {
    sessionId: "s-0712",
    agentLabel: "claude-code-cli",
    startedAt: `${DAY}14:02:00+09:00`,
    endedAt: null,
    isLive: true,
    eventCount: 18,
    verdictSummary: { allow: 0, warn: 4, require_approval: 0, block: 4 }
  },
  {
    sessionId: "s-0711",
    agentLabel: "claude-code-cli",
    startedAt: `${DAY}11:38:00+09:00`,
    endedAt: `${DAY}11:52:00+09:00`,
    isLive: false,
    eventCount: 17,
    verdictSummary: { allow: 0, warn: 0, require_approval: 4, block: 2 }
  },
  {
    sessionId: "s-0710",
    agentLabel: "claude-code-cli",
    startedAt: `${DAY}09:15:00+09:00`,
    endedAt: `${DAY}09:31:00+09:00`,
    isLive: false,
    eventCount: 16,
    verdictSummary: { allow: 7, warn: 4, require_approval: 0, block: 0 }
  }
];

const TIMELINE_0712_NODES: ApiTimelineNode[] = [
  { eventId: "e1", type: "USER_INPUT", ts: `${DAY}14:02:12+09:00`, summary: "README를 요약해줘", detail: null },
  {
    eventId: "e2",
    type: "AGENT_STEP",
    ts: `${DAY}14:02:28+09:00`,
    summary: "README 내 지시문 발견 · .env 읽기 설정",
    detail: null
  },
  {
    eventId: "e3",
    type: "TOOL_CALL",
    ts: `${DAY}14:02:30+09:00`,
    summary: 'read_file(".env")',
    toolName: "read_file",
    direction: "req",
    argsDigest: "sha256:9f2c1af9d3e7…",
    detail: null
  },
  {
    eventId: "e4",
    type: "VERDICT",
    ts: `${DAY}14:02:41+09:00`,
    summary: "차단",
    verdict: "block",
    riskScore: 92,
    detail: {
      matchedPolicyIds: ["block_env_file_read", "deny_secret_exfil"],
      detections: [
        { type: "SECRET", subtype: "OPENAI_KEY", span: { start: 0, end: 20 }, confidence: 0.98, maskedAs: "SECRET_OPENAI" },
        { type: "SECRET", subtype: "GENERIC_PASSWORD", span: { start: 25, end: 41 }, confidence: 0.92, maskedAs: "텍스트" }
      ],
      maskDiffRef: "/api/v1/events/e4/mask-diff",
      hash: "a3f9c1",
      prevHash: ""
    }
  },
  {
    eventId: "e5",
    type: "RESULT",
    ts: `${DAY}14:02:49+09:00`,
    summary: '"GuardMCP 정책에 의해 차단되었습니다" 오류 반환',
    detail: null
  },
  {
    eventId: "e6",
    type: "AGENT_STEP",
    ts: `${DAY}14:02:28+09:00`,
    summary: "차단 응답 수신 · 작업 중단, 사용자에게 보고",
    detail: null
  }
];

const TIMELINE_0712: ApiSessionTimelineResponse = {
  sessionId: "s-0712",
  agentLabel: "claude-code-cli",
  startedAt: `${DAY}14:02:00+09:00`,
  isLive: true,
  chainStatus: "valid",
  nodes: TIMELINE_0712_NODES,
  nextCursor: null
};

const emptyTimeline = (sessionId: string): ApiSessionTimelineResponse => ({
  sessionId,
  agentLabel: "claude-code-cli",
  startedAt: `${DAY}00:00:00+09:00`,
  isLive: false,
  chainStatus: "valid",
  nodes: [],
  nextCursor: null
});

export function timelineOf(sessionId: string): ApiSessionTimelineResponse {
  return sessionId === "s-0712" ? TIMELINE_0712 : emptyTimeline(sessionId);
}

/** GET /events/{id}: only the #s-0712 fixture has scripted nodes to look up. */
export function eventLookup(eventId: string): ApiEventLookupResponse | undefined {
  const node = TIMELINE_0712_NODES.find((candidate) => candidate.eventId === eventId);
  return node && { sessionId: "s-0712", ...node };
}

// The consultation log the get_log tool read — the source of the masked PII the reveal modal
// shows (POST /events/{id}/reveal, spec §5.3 no.5). Out of the GMCP-28 timeline API's scope: it
// never returns raw or masked body text, so this fixture backs only the separate reveal endpoint.
const line = (no: string, ...parts: ContentLine["parts"]): ContentLine => ({ no, parts });
const CONSULT_MASKED: ContentLine[] = [
  line("01", { text: "[상담 로그 #C-20260712-142]" }),
  line("02", { text: "유형: 환불 계좌 변경, 2026-07-12 14:02" }),
  line("03", { text: "고객 김민서 님이 환불 계좌 변경을 요청함." }),
  line("04", { text: "등록 연락처 " }, { mask: "PHONE" }, { text: " 으로 본인 확인 완료." }),
  line("05", { text: "변경 계좌: 국민은행 " }, { mask: "BANK_ACCOUNT" }, { text: " (예금주: 김민서)" }),
  line("06", { text: "본인확인 과정에서 주민등록번호 " }, { mask: "RRN_LIKE" }, { text: " 확인" }),
  line("07", { text: "영수증 발송: " }, { mask: "EMAIL" }),
  line("08", { text: "배송지: " }, { mask: "ADDRESS" })
];
const CONSULT_RAW = [
  "[상담 로그 #C-20260712-142]",
  "유형: 환불 계좌 변경, 2026-07-12 14:02",
  "고객 김민서 님이 환불 계좌 변경을 요청함.",
  "등록 연락처 010-4728-1953 으로 본인 확인 완료.",
  "변경 계좌: 국민은행 942102-01-583274 (예금주: 김민서)",
  "본인확인 과정에서 주민등록번호 881105-2069417 확인",
  "영수증 발송: minseo.kim88@exampe.com",
  "배송지: 경기도 성남시 분당구 판교역로 235, 704동 1102호"
].join("\n");

const REVEAL: RevealContent = {
  source: "e-000  get_log",
  caseId: "#C-20260712-142",
  raw: CONSULT_RAW,
  masked: CONSULT_MASKED
};

export function revealOf(): RevealContent {
  return REVEAL;
}

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
message: "탐지된 시크릿의 외부 유출을 차단합니다."`,
  mask_kr_phone: `id: mask_kr_phone
match:
  detections: [PHONE]
  direction: response
action: mask
severity: medium
message: "응답의 한국 전화번호를 마스킹합니다."`
};

export function policyDetail(id: string): { id: string; yaml: string } {
  return { id, yaml: POLICY_YAML[id] ?? `id: ${id}\n# 이 정책의 정의를 찾지 못했습니다.` };
}
