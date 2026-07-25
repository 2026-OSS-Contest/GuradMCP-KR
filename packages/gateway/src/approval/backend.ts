// Approval backend interface (§4.5). The Control Plane approval console
// (GMCP-82) does not exist yet; this file fixes the integration point so it
// can be swapped in later without touching the action router.
import { randomUUID } from "node:crypto";
import type { Direction } from "@guardmcp/policy-engine";

export type ApprovalDecision = "block" | "approve" | "approve_masked" | "expired";
export type ApprovalRequestId = string;

export interface ApprovalRequestInput {
  eventRef: string;
  direction: Direction;
  toolName: string;
  riskScore: number;
  matchedPolicyIds: string[];
}

export interface ApprovalBackend {
  submit(req: ApprovalRequestInput): Promise<ApprovalRequestId>;
  /** Resolves with the operator's decision, or "expired" once `timeoutMs` elapses unresolved (FR-APR-03). */
  awaitDecision(id: ApprovalRequestId, timeoutMs: number): Promise<ApprovalDecision>;
}

/**
 * Reference in-memory implementation: holds a request until `resolve()` is
 * called or `timeoutMs` elapses, whichever comes first. This is the shape a
 * real GMCP-82 HTTP client should match (`submit` registers with Control
 * Plane, `awaitDecision` long-polls or waits on a webhook callback).
 */
export class InMemoryApprovalBackend implements ApprovalBackend {
  #pending = new Map<ApprovalRequestId, (decision: ApprovalDecision) => void>();

  async submit(_req: ApprovalRequestInput): Promise<ApprovalRequestId> {
    return randomUUID();
  }

  async awaitDecision(id: ApprovalRequestId, timeoutMs: number): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        resolve("expired");
      }, timeoutMs);
      this.#pending.set(id, (decision) => {
        clearTimeout(timer);
        resolve(decision);
      });
    });
  }

  /** Settles a pending request early (what a Control Plane webhook would call). Returns false if unknown/already settled. */
  resolve(id: ApprovalRequestId, decision: ApprovalDecision): boolean {
    const settle = this.#pending.get(id);
    if (!settle) return false;
    this.#pending.delete(id);
    settle(decision);
    return true;
  }
}

/**
 * No approval console is wired up on this branch, so nothing can ever answer
 * `submit()`. Auto-expiring immediately (rather than actually waiting out
 * `timeoutSeconds`) keeps the gateway fail-closed (NFR-03) without holding
 * live requests open for up to 120s. Replace with `InMemoryApprovalBackend`
 * or a real GMCP-82 client once a console exists to resolve requests.
 */
export function createAutoExpireApprovalBackend(): ApprovalBackend {
  return {
    async submit(): Promise<ApprovalRequestId> {
      return randomUUID();
    },
    async awaitDecision(): Promise<ApprovalDecision> {
      return "expired";
    }
  };
}
