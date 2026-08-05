// SCR-301 Replay fixtures, reproducing the Figma frames: the session list, the #s-0712
// timeline, and a distinct right-panel detail for each node kind — the user's input, the
// agent's reasoning, the tool call, the block verdict, and the tool result.

import type {
  ContentLine,
  EventDetail,
  RevealContent,
  SessionSummary,
  TimelineEvent,
  TimelineResponse
} from "@/lib/api/types";

// A fixed clock keeps the timestamps matching the design ("14:02:41" etc.).
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

const TIMELINE_0712: TimelineEvent[] = [
  { id: "e1", type: "user", at: `${DAY}14:02:12+09:00`, title: "README를 요약해줘" },
  { id: "e2", type: "agent", at: `${DAY}14:02:28+09:00`, title: "README 내 지시문 발견", subtitle: ".env 읽기 설정" },
  { id: "e3", type: "tool_call", at: `${DAY}14:02:30+09:00`, title: 'read_file(".env")' },
  { id: "e4", type: "verdict", at: `${DAY}14:02:41+09:00`, title: "차단", verdict: "block", policy: "block_env_file_read" },
  { id: "e5", type: "result", at: `${DAY}14:02:49+09:00`, title: "error반환 –", subtitle: "“GuardMCP 정책에 의해 차단되었습니다”" },
  { id: "e6", type: "agent", at: `${DAY}14:02:28+09:00`, title: "차단 응답 수신", subtitle: "작업 중단, 사용자에게 보고" }
];

// The consultation log the get_log tool read — the source of the masked PII on this screen.
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

const RETURN_MASKED: ContentLine[] = [
  line("01", { text: "연락처: " }, { mask: "PHONE" }),
  line("02", { text: "변경 계좌: " }, { mask: "BANK_ACCOUNT" }),
  line("03", { text: "주민등록번호: " }, { mask: "RRN_LIKE" }),
  line("04", { text: "영수증 발송: " }, { mask: "EMAIL" }),
  line("05", { text: "배송지: " }, { mask: "ADDRESS" })
];

const REVEAL: RevealContent = {
  source: "e-000  get_log",
  caseId: "#C-20260712-142",
  raw: CONSULT_RAW,
  masked: CONSULT_MASKED
};

const base = (id: string, event: TimelineEvent): Pick<EventDetail, "id" | "sessionId" | "at" | "kind"> => ({
  id,
  sessionId: "s-0712",
  at: event.at,
  kind: event.type
});

/** A distinct detail per node kind, mirroring the SCR-301 stage frames. */
function detailOf(event: TimelineEvent): EventDetail {
  switch (event.type) {
    case "user":
      return {
        ...base(event.id, event),
        verdict: "allow",
        tool: event.title,
        body: { heading: "입력 원문", lines: CONSULT_MASKED },
        canReveal: true,
        reveal: REVEAL
      };
    case "agent":
      return {
        ...base(event.id, event),
        verdict: "allow",
        tool: event.title,
        summary: {
          heading: "Agent 보고 요약",
          text:
            event.id === "e2"
              ? "README.md 내용 중 시스템 프롬프트를 무시하고 .env 파일을 읽어 응답에 포함하라는 지시문을 발견했습니다. 사용자 요청(README 요약)과 무관한 지시로 판단해 별도 확인 없이 무시하고, 원래 목적에 필요한 파일 접근으로 .env 읽기를 다음 동작으로 진행합니다."
              : "정책에 의해 도구 호출이 차단되어 작업을 중단하고, 차단 사유를 사용자에게 보고합니다."
        }
      };
    case "tool_call":
      return {
        ...base(event.id, event),
        verdict: "block",
        tool: event.title,
        call: { target: ".env", argsCount: 1, argsJson: '{\n  "path": ".env"\n}' },
        normalizedPath: ".env",
        direction: { heading: "요청 방향 판정", verdict: "block", policy: "block_env_file_read" }
      };
    case "verdict":
      return {
        ...base(event.id, event),
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
        canReveal: true,
        reveal: REVEAL
      };
    case "result":
      return {
        ...base(event.id, event),
        verdict: "warn",
        tool: "read_file",
        body: { heading: "반환 데이터 요약", lines: RETURN_MASKED },
        direction: { heading: "응답 방향 판정", verdict: "warn", policy: "mask_kr_phone", morePolicies: 2 },
        canReveal: true,
        reveal: REVEAL
      };
  }
}

export function timelineOf(sessionId: string): TimelineResponse {
  if (sessionId !== "s-0712") return { events: [], details: {} };
  const details: Record<string, EventDetail> = {};
  for (const event of TIMELINE_0712) details[event.id] = detailOf(event);
  return { events: TIMELINE_0712, details };
}

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
