// SCR-402 Approval Console fixtures (spec §5.6). The control plane serves these endpoints for
// real; the mock keeps its own queue so the 120s fail-closed timeout, the resolved history and
// the 409 a second operator would hit can all be exercised without a gateway.

import type { Approval, ApprovalDecision, ContentLine } from "@/lib/api/types";

/** Spec §5.6: the gateway fails closed 120 seconds after a call is held. */
const TIMEOUT_MS = 120_000;

const line = (no: string, parts: ContentLine["parts"]): ContentLine => ({ no, parts });

/** The mask preview the design draws on the send_email card. */
// A `mask` part marks the run masking would replace: the raw pane underlines it, the masked
// pane opposite swaps in the chip. Same shape, two readings.
const RAW: ContentLine[] = [
  line("01", [{ text: "등록 연락처 " }, { mask: "010-4728-1953" }, { text: " 으로 본인 확인 완료." }]),
  line("02", [{ text: "변경 계좌: 국민은행 " }, { mask: "942102-01-583274" }, { text: " (예금주: 김민서)" }]),
  line("03", [{ text: "본인 확인 과정에서 주민등록번호 " }, { mask: "881105-2069417" }, { text: " 확인" }])
];

const MASKED: ContentLine[] = [
  line("01", [{ text: "등록 연락처 " }, { mask: "PHONE" }, { text: " 으로 본인 확인 완료." }]),
  line("02", [{ text: "변경 계좌: 국민은행 " }, { mask: "BANK_ACCOUNT" }, { text: " (예금주: 김민서)" }]),
  line("03", [{ text: "본인확인 과정에서 주민등록번호 " }, { mask: "RRN_LIKE" }, { text: " 확인" }])
];

/** Held calls, seeded so a fresh page always has something to decide. */
let queue: Approval[] = [];
let resolved: Approval[] = [];
let seq = 0;

function held(values: Omit<Approval, "id" | "status" | "requestedAt" | "expiresAt" | "sessionId">): Approval {
  const now = Date.now();
  seq += 1;
  return {
    id: `apr-${seq}`,
    sessionId: "s-0712",
    status: "pending",
    requestedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TIMEOUT_MS).toISOString(),
    ...values
  };
}

function seed() {
  seq = 0;
  queue = [
    held({
      toolName: "send_email",
      arguments: { to: "external@example.com" },
      riskReason: "본문에 시크릿이 포함되어 있습니다.",
      policyId: "approve_external_email_with_secret",
      riskTags: [{ type: "SECRET", count: 1 }],
      threatScore: 92,
      maskPreview: { raw: RAW, masked: MASKED }
    }),
    held({
      toolName: "fetch_url",
      arguments: { url: "http://198.51.100.7/collect" },
      riskReason: "신뢰할 수 없는 URL 호출입니다.",
      policyId: "approve_untrusted_url_fetch",
      riskTags: [{ type: "INJECTION", count: 1 }],
      threatScore: 58
    })
  ];
  // Seeded as already handled, so the history is never empty on a first visit. Requested before
  // it was decided, or the elapsed column would read negative.
  const decidedAt = Date.now() - 30_000;
  resolved = [
    {
      ...held({
        toolName: "fetch_email",
        arguments: { id: "m-1180" },
        riskReason: "외부 도메인 첨부가 포함되어 있습니다.",
        policyId: "approve_external_email"
      }),
      requestedAt: new Date(decidedAt - 9_000).toISOString(),
      status: "approved",
      decision: "approve",
      decidedBy: "administrator",
      decidedAt: new Date(decidedAt).toISOString()
    }
  ];
}

seed();

/** Anything past its deadline is blocked before it is served — the gateway fails closed. */
function expire() {
  const now = Date.now();
  const due = queue.filter((approval) => Date.parse(approval.expiresAt) <= now);
  if (!due.length) return;
  queue = queue.filter((approval) => Date.parse(approval.expiresAt) > now);
  for (const approval of due) {
    resolved.unshift({ ...approval, status: "expired", decidedAt: new Date().toISOString(), decidedBy: null });
  }
}

export function approvalsIn(status: "pending" | "resolved"): Approval[] {
  expire();
  return status === "pending" ? queue : resolved;
}

const STATUS_BY_DECISION: Record<ApprovalDecision, Approval["status"]> = {
  block: "blocked",
  approve_masked: "approved_masked",
  approve: "approved"
};

/** `undefined` means the call was already resolved — the caller answers 409, as the API does. */
export function decide(id: string, decision: ApprovalDecision, by = "administrator"): Approval | undefined {
  expire();
  const approval = queue.find((entry) => entry.id === id);
  if (!approval) return undefined;
  queue = queue.filter((entry) => entry.id !== id);
  const done: Approval = {
    ...approval,
    status: STATUS_BY_DECISION[decision],
    decision,
    decidedBy: by,
    decidedAt: new Date().toISOString()
  };
  resolved.unshift(done);
  return done;
}

/** The scenario switcher empties the console; reopening it should hand back a full queue. */
export function resetApprovals(empty: boolean) {
  if (empty) {
    queue = [];
    resolved = [];
    return;
  }
  if (!queue.length && !resolved.length) seed();
}
