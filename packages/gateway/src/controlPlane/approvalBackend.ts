// Control Plane-backed ApprovalBackend (§5.1 GMCP-26): submits a held call as a Control
// Plane `Approval` record (`POST /api/v1/approvals`) and polls for its resolution (§10:
// "SSE 또는 polling" — SSE is not implemented on either side yet, so this is the polling leg).
// A local fail-closed deadline guarantees `awaitDecision` always resolves within `timeoutMs`
// even if Control Plane never answers (NFR-03) — the poll is best-effort, the deadline is not.
import { randomUUID } from "node:crypto";
import type {
  ApprovalBackend,
  ApprovalDecision,
  ApprovalOutcome,
  ApprovalRequestId,
  ApprovalRequestInput,
} from "../approval/backend.js";

const POLL_INTERVAL_MS = 1_000;
/** Requests Control Plane never accepted (submit-time outage) carry this prefix so
 *  `awaitDecision` fails closed immediately instead of polling a record that was never created. */
const UNREACHABLE_PREFIX = "unreachable-";

type RemoteApprovalStatus = "pending" | "approved" | "approved_masked" | "blocked" | "expired";

interface RemoteApproval {
  id: string;
  status: RemoteApprovalStatus;
  decidedBy?: string | null;
}

const STATUS_TO_DECISION: Record<Exclude<RemoteApprovalStatus, "pending">, ApprovalDecision> = {
  approved: "approve",
  approved_masked: "approve_masked",
  blocked: "block",
  expired: "expired",
};

export function createControlPlaneApprovalBackend(baseUrl: string): ApprovalBackend {
  return {
    async submit(req: ApprovalRequestInput): Promise<ApprovalRequestId> {
      try {
        const response = await fetch(new URL("/api/v1/approvals", baseUrl), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: req.sessionId,
            toolName: req.toolName,
            arguments: req.arguments,
            riskReason: req.message,
            policyId: req.policyId,
            riskTags: req.riskTags,
            threatScore: req.riskScore,
            ...(req.maskPreview ? { maskPreview: req.maskPreview } : {}),
          }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) throw new Error(`Control Plane rejected the approval request (${response.status})`);
        const body = (await response.json()) as { id: string };
        return body.id;
      } catch {
        return `${UNREACHABLE_PREFIX}${randomUUID()}`;
      }
    },

    async awaitDecision(id: ApprovalRequestId, timeoutMs: number): Promise<ApprovalOutcome> {
      if (id.startsWith(UNREACHABLE_PREFIX)) return { decision: "expired" };
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        try {
          const approval = await fetchApproval(baseUrl, id);
          if (approval && approval.status !== "pending") {
            return {
              decision: STATUS_TO_DECISION[approval.status],
              ...(approval.decidedBy ? { decidedBy: approval.decidedBy } : {})
            };
          }
        } catch {
          // Control Plane unreachable this tick — keep polling until the local deadline fires.
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) return { decision: "expired" };
        await sleep(Math.min(POLL_INTERVAL_MS, remaining));
      }
    },
  };
}

async function fetchApproval(baseUrl: string, id: ApprovalRequestId): Promise<RemoteApproval | undefined> {
  const response = await fetch(new URL("/api/v1/approvals", baseUrl), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`Control Plane approvals list returned ${response.status}`);
  const approvals = (await response.json()) as RemoteApproval[];
  return approvals.find((approval) => approval.id === id);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
