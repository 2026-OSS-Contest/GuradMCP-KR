// SCR-402 Approval Console fixtures (spec §5.6). The control plane serves these endpoints for
// real; the mock keeps its own queue so the 120s fail-closed timeout, the resolved history and
// the 409 a second operator would hit can all be exercised without a gateway.
//
// Every card here is a call the replay screen can show you (GMCP-117): the two held ones are the
// last node of sessions #s-0712 and #s-0713, and the resolved one is how #s-0711 ended. The queue
// used to hold a `db_query` against a server the inventory reports as disconnected, under a
// policy (`approve_bulk_export`) that exists in no pack.

import type { Approval, ApprovalDecision, ContentLine, RawLine } from "@/lib/api/types";
import {
  HELD_SESSION_ID,
  LIVE_SESSION_ID,
  APPROVED_SESSION_ID,
  PARTNER_EMAIL,
  PASTED_KEY,
  TICKET_ID,
  VENDOR_EMAIL,
  minutesAgo
} from "./demo-story";

/** Spec §5.6: the gateway fails closed 120 seconds after a call is held. */
const TIMEOUT_MS = 120_000;

const line = (no: string, parts: ContentLine["parts"]): ContentLine => ({ no, parts });
const rawLine = (no: string, parts: RawLine["parts"]): RawLine => ({ no, parts });

/**
 * What each card would send, beside what would go instead. The raw pane carries the values
 * themselves (`sensitive`); the masked pane opposite carries the labels that replace them.
 *
 * The gateway can only offer this while the call is held — the preview is computed from the
 * pending request and dropped the moment it is decided (NFR-04), which is why it appears on a
 * card and nowhere else.
 */
const SECRET_RAW: RawLine[] = [
  rawLine("01", [{ text: `${TICKET_ID} 상담 처리 요약입니다.` }]),
  rawLine("02", [{ text: "연동 키는 " }, { sensitive: PASTED_KEY }, { text: " 입니다." }]),
  rawLine("03", [{ text: "문의는 회신 주세요." }])
];

const SECRET_MASKED: ContentLine[] = [
  line("01", [{ text: `${TICKET_ID} 상담 처리 요약입니다.` }]),
  line("02", [{ text: "연동 키는 " }, { mask: "SECRET_LLM_API_KEY" }, { text: " 입니다." }]),
  line("03", [{ text: "문의는 회신 주세요." }])
];

const PII_RAW: RawLine[] = [
  rawLine("01", [{ text: "환불 상담 목록 (2026-03)" }]),
  rawLine("02", [{ text: "정다은 · " }, { sensitive: "010-3456-7890" }, { text: " · 환불 완료" }]),
  rawLine("03", [{ text: "본인확인 주민등록번호 " }, { sensitive: "881124-2300149" }])
];

const PII_MASKED: ContentLine[] = [
  line("01", [{ text: "환불 상담 목록 (2026-03)" }]),
  line("02", [{ text: "정다은 · " }, { mask: "PHONE" }, { text: " · 환불 완료" }]),
  line("03", [{ text: "본인확인 주민등록번호 " }, { mask: "RRN_LIKE" }])
];

/** Held calls, seeded so a fresh page always has something to decide. */
let queue: Approval[] = [];
let resolved: Approval[] = [];
let seq = 0;

/**
 * `heldSecondsAgo` is how long the gateway has been holding the call, so the countdown on the
 * card is the one the story implies — the two seeded calls are the last thing their sessions did.
 */
function held(
  values: Omit<Approval, "id" | "status" | "requestedAt" | "expiresAt">,
  heldSecondsAgo = 0
): Approval {
  const requestedAt = Date.now() - heldSecondsAgo * 1_000;
  seq += 1;
  return {
    id: `apr-${seq}`,
    status: "pending",
    requestedAt: new Date(requestedAt).toISOString(),
    expiresAt: new Date(requestedAt + TIMEOUT_MS).toISOString(),
    ...values
  };
}

function seed() {
  seq = 0;
  queue = [
    // #s-0712 · e13: the user's own integration key, on its way to a partner outside the org.
    held(
      {
        sessionId: LIVE_SESSION_ID,
        toolName: "send_email",
        arguments: { to: PARTNER_EMAIL, subject: `${TICKET_ID} 상담 처리 요약` },
        riskReason: "본문에 시크릿이 포함되어 있습니다.",
        policyId: "approve_external_email_with_secret",
        riskTags: [{ type: "SECRET", count: 1 }],
        threatScore: 78,
        maskPreview: { raw: SECRET_RAW, masked: SECRET_MASKED }
      },
      7
    ),
    // #s-0713 · h4: personal data, on its way to an outside contractor. A different policy holds
    // it, which is the point of having both on screen.
    held(
      {
        sessionId: HELD_SESSION_ID,
        toolName: "send_email",
        arguments: { to: VENDOR_EMAIL, subject: "환불 상담 목록 (2026-03)" },
        riskReason: "외부 수신자에게 개인정보가 전송됩니다.",
        policyId: "approve_external_email_with_korean_pii",
        riskTags: [
          { type: "PII", count: 2 }
        ],
        threatScore: 74,
        maskPreview: { raw: PII_RAW, masked: PII_MASKED }
      },
      23
    )
  ];
  // #s-0711, an hour ago: the operator chose 마스킹 후 승인, so the mail went out with the key
  // replaced — `docs/external-email-approval-demo.md`'s first column. Seeded as already handled,
  // so the history is never empty on a first visit.
  resolved = [
    {
      ...held({
        sessionId: APPROVED_SESSION_ID,
        toolName: "send_email",
        arguments: { to: PARTNER_EMAIL, subject: "환불 상담 처리 요약" },
        riskReason: "본문에 시크릿이 포함되어 있습니다.",
        policyId: "approve_external_email_with_secret",
        riskTags: [{ type: "SECRET", count: 1 }],
        threatScore: 78
      }),
      requestedAt: minutesAgo(62 - 1),
      status: "approved_masked",
      decision: "approve_masked",
      decidedBy: "administrator",
      decidedAt: minutesAgo(61)
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

/** The endpoint is unfiltered, so the mock hands back the whole ledger the way the API does. */
export function allApprovals(): Approval[] {
  expire();
  return [...queue, ...resolved];
}

/**
 * What the SCR-000 pending badge counts (spec §4.1). It reads this queue rather than a tally of
 * its own, so deciding a call here moves the badge — the two cannot drift apart.
 */
export function pendingCount(): number {
  expire();
  return queue.length;
}

/**
 * The stream raises one held call per connection, into this same queue (spec §4.1: the pending
 * badge moves on the event, not on the next poll).
 *
 * It is the live session trying the same summary on a second recipient — a retry is what an agent
 * does when the first send does not come back, and it keeps the raised card inside a session the
 * replay screen actually has. Every held call is a `send_email` because, in the packs as shipped,
 * nothing else can be: both external-mail policies match `tool: send_email`, and the untrusted
 * backstop matches `send_*`.
 */
export function raiseApproval(): void {
  expire();
  queue.push(
    held({
      sessionId: LIVE_SESSION_ID,
      toolName: "send_email",
      arguments: { to: "dae-eun.jung@example.co.kr", subject: `${TICKET_ID} 상담 처리 요약 (재전송)` },
      riskReason: "본문에 시크릿이 포함되어 있습니다.",
      policyId: "approve_external_email_with_secret",
      riskTags: [{ type: "SECRET", count: 1 }],
      threatScore: 78,
      maskPreview: { raw: SECRET_RAW, masked: SECRET_MASKED }
    })
  );
}


const STATUS_BY_DECISION: Record<ApprovalDecision, Approval["status"]> = {
  block: "blocked",
  approve_masked: "approved_masked",
  approve: "approved"
};

/**
 * `undefined` means the call was already resolved — the caller answers 409, as the API does.
 *
 * `by` defaults to null the way the real endpoint does: `decidedBy` is optional on the wire and
 * the console has no operator identity to send, so a decision made here records none. Naming one
 * anyway would leave the 처리자 column looking populated in dev and empty against a gateway.
 */
export function decide(id: string, decision: ApprovalDecision, by: string | null = null): Approval | undefined {
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
