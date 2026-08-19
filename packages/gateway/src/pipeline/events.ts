// Bridge between the action router (⑦) and Audit Logger/Replay Dashboard
// (⑧/⑨). Persistence and hash-chaining are out of scope for GMCP-15 (§2);
// this module only guarantees that every routing outcome is emitted so a
// future subscriber (Control Plane ingest, or an in-process SSE writer) can
// pick it up. The `type` values mirror `apps/console/lib/sse.ts` exactly, so
// a subscriber here can be wired straight into an SSE `event:` field.
import { EventEmitter } from "node:events";
import type { ApprovalRequestId } from "../approval/backend.js";
import type { GuardEvent } from "./types.js";

export type GuardBusEventType =
  | "guard.event"
  | "approval.created"
  | "approval.resolved"
  | "policy.reloaded"
  | "policy.reload_failed";

const GUARD_BUS_EVENT_TYPES: readonly GuardBusEventType[] = [
  "guard.event",
  "approval.created",
  "approval.resolved",
  "policy.reloaded",
  "policy.reload_failed"
];

export interface ApprovalCreatedPayload {
  requestId: ApprovalRequestId;
  eventRef: string;
  timeoutSeconds: number;
}

export interface ApprovalResolvedPayload {
  requestId: ApprovalRequestId;
  eventRef: string;
  decision: string;
}

/** FR-POL-03 §4.5 success payload. */
export interface PolicyReloadedPayload {
  packId: string;
  version: string;
  reloadedAt: string;
  policyCount: number;
}

/** FR-POL-03 §4.5 failure payload (not in SCREEN-SPACE.md §6.3 yet — defined here per §4.5's note). */
export interface PolicyReloadFailedPayload {
  packId: string;
  filePath: string;
  reason: string;
  detail: string;
  occurredAt: string;
}

export interface GuardBusMessage {
  type: GuardBusEventType;
  data:
    | GuardEvent
    | ApprovalCreatedPayload
    | ApprovalResolvedPayload
    | PolicyReloadedPayload
    | PolicyReloadFailedPayload;
}

export const guardEventBus = new EventEmitter();

function publish(message: GuardBusMessage): void {
  guardEventBus.emit(message.type, message);
}

export function emitGuardEvent(event: GuardEvent): void {
  publish({ type: "guard.event", data: event });
}

export function emitApprovalCreated(data: ApprovalCreatedPayload): void {
  publish({ type: "approval.created", data });
}

export function emitApprovalResolved(data: ApprovalResolvedPayload): void {
  publish({ type: "approval.resolved", data });
}

export function emitPolicyReloaded(data: PolicyReloadedPayload): void {
  publish({ type: "policy.reloaded", data });
}

export function emitPolicyReloadFailed(data: PolicyReloadFailedPayload): void {
  publish({ type: "policy.reload_failed", data });
}

export function onGuardBusMessage(listener: (message: GuardBusMessage) => void): () => void {
  const handler = (message: GuardBusMessage) => listener(message);
  for (const type of GUARD_BUS_EVENT_TYPES) guardEventBus.on(type, handler);
  return () => {
    for (const type of GUARD_BUS_EVENT_TYPES) guardEventBus.off(type, handler);
  };
}
