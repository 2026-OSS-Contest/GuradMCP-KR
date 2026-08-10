// Pipeline stage ⑧ (Audit Logger) — gateway side of the Event Emitter
// (docs/task-docs/GMCP-24/audit-logging-implementation.md §5). Subscribes to the in-process bus
// (./events.ts) that the action router (GMCP-15) already publishes every verdict onto, and
// forwards each GuardEvent to the Control Plane's ingest API (POST /api/v1/events).
//
// AUDIT-04/AUDIT-05 (§3.1, §8.1 separation principle): publishing never blocks or is awaited by
// the request path that emitted the event. A bounded local queue absorbs bursts; a failed or
// timed-out publish is logged and dropped, never retried — the spec explicitly allows loss
// ("재시도 큐 또는 로컬 버퍼 후 유실 허용") in exchange for never becoming a second way a Control
// Plane outage can affect the inspection path.
//
// Must be the sole reader of GuardEvent.rawPayload: `captureGuardEvent` strips it from the
// shared bus object synchronously, before any later `guardEventBus` subscriber (e.g. a future
// SSE writer) could see it (NFR-04).
import { onGuardBusMessage } from "./events.js";
import { logJson } from "./logger.js";
import type { GuardEvent } from "./types.js";

const controlPlaneUrl = process.env.CONTROL_PLANE_URL ?? "http://localhost:8080";
const eventsEndpoint = new URL("/api/v1/events", controlPlaneUrl);
const publishTimeoutMs = 2_000;
const maxQueueDepth = 500;

const queue: GuardEvent[] = [];
let draining = false;
let drainPromise: Promise<void> = Promise.resolve();

const counters = { published: 0, failed: 0, dropped: 0 };

export interface AuditPublisherMetrics {
  published: number;
  failed: number;
  dropped: number;
  queueDepth: number;
  /** 1 when nothing has been attempted yet, so an idle gateway doesn't read as "all failing". */
  successRate: number;
}

export function auditPublisherMetrics(): AuditPublisherMetrics {
  const attempted = counters.published + counters.failed;
  return {
    published: counters.published,
    failed: counters.failed,
    dropped: counters.dropped,
    queueDepth: queue.length,
    successRate: attempted === 0 ? 1 : counters.published / attempted
  };
}

/** Test seam: drains no state a production process ever needs to reset mid-run. */
export function resetAuditPublisherState(): void {
  queue.length = 0;
  draining = false;
  drainPromise = Promise.resolve();
  counters.published = 0;
  counters.failed = 0;
  counters.dropped = 0;
}

/** Test seam: awaits the in-flight drain loop (a no-op when the queue is already empty). */
export function flushAuditPublishQueue(): Promise<void> {
  return drainPromise;
}

/**
 * The actual bus handler, split out from the `onGuardBusMessage` registration below so tests
 * can call it directly without depending on module-load side effects.
 */
export function captureGuardEvent(event: GuardEvent): void {
  // NFR-06: logged independent of, and before, any publish attempt — the structured audit
  // trail exists even when the Control Plane is unreachable.
  logJson("info", "guard event captured", { eventId: event.eventId, sessionId: event.sessionId, verdict: event.verdict });

  const rawPayload = event.rawPayload;
  delete event.rawPayload;
  enqueue(rawPayload === undefined ? event : { ...event, rawPayload });
}

function enqueue(event: GuardEvent): void {
  if (queue.length >= maxQueueDepth) {
    counters.dropped += 1;
    logJson("warn", "audit publish queue full; dropping event", {
      eventId: event.eventId,
      sessionId: event.sessionId,
      verdict: event.verdict
    });
    return;
  }
  queue.push(event);
  if (!draining) {
    draining = true;
    drainPromise = drain();
  }
}

/**
 * `draining` must be cleared from *inside* this function's own try/finally, not via a
 * `.finally()` chained onto the promise `drain()` returns. Chaining externally schedules the
 * reset as a fresh microtask *after* this function's synchronous tail (the `while` condition
 * seeing `queue.shift()` return `undefined`) — which opens a window where a concurrent
 * `enqueue()` sees `draining` still `true`, assumes this loop will pick its event up, and the
 * event is silently never published. Resetting it here, before the function returns, is part of
 * the same synchronous continuation as the loop's exit decision, so no such window exists.
 */
async function drain(): Promise<void> {
  try {
    let event: GuardEvent | undefined;
    while ((event = queue.shift())) {
      await publishOnce(event);
    }
  } finally {
    draining = false;
  }
}

async function publishOnce(event: GuardEvent): Promise<void> {
  try {
    const response = await fetch(eventsEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(publishTimeoutMs)
    });
    if (!response.ok) throw new Error(`control plane returned ${response.status}`);
    counters.published += 1;
  } catch (error) {
    counters.failed += 1;
    logJson("warn", "audit event publish failed; dropping (fire-and-forget)", {
      eventId: event.eventId,
      sessionId: event.sessionId,
      verdict: event.verdict,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/** The actual production wiring, factored out so a test can exercise this exact line instead of
 *  re-implementing it by hand. */
export function subscribeToGuardBus(): () => void {
  return onGuardBusMessage((message) => {
    if (message.type === "guard.event") captureGuardEvent(message.data as GuardEvent);
  });
}

if (process.env.NODE_ENV !== "test") {
  subscribeToGuardBus();
}
