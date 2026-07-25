// Bridge between the action router (⑦) and Audit Logger/Replay Dashboard
// (⑧/⑨). Persistence and hash-chaining are out of scope for GMCP-15 (§2);
// this module only guarantees that every routing outcome is emitted so a
// future subscriber (Control Plane ingest, or an in-process SSE writer) can
// pick it up. The `type` values mirror `apps/console/lib/sse.ts` exactly, so
// a subscriber here can be wired straight into an SSE `event:` field.
import { EventEmitter } from "node:events";
import type { ApprovalRequestId } from "../approval/backend.js";
import type { GuardEvent } from "./types.js";

export type GuardBusEventType = "guard.event" | "approval.created" | "approval.resolved";

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

export interface GuardBusMessage {
  type: GuardBusEventType;
  data: GuardEvent | ApprovalCreatedPayload | ApprovalResolvedPayload;
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

export function onGuardBusMessage(listener: (message: GuardBusMessage) => void): () => void {
  const handler = (message: GuardBusMessage) => listener(message);
  guardEventBus.on("guard.event", handler);
  guardEventBus.on("approval.created", handler);
  guardEventBus.on("approval.resolved", handler);
  return () => {
    guardEventBus.off("guard.event", handler);
    guardEventBus.off("approval.created", handler);
    guardEventBus.off("approval.resolved", handler);
  };
}
