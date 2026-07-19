// Typed SSE client for the gateway event stream (UI spec §6.3).
// Handles exponential-backoff reconnect; the caller backfills gaps via polling on recovery.

export type GuardEventType =
  | "guard.event"
  | "approval.created"
  | "approval.resolved"
  | "policy.reloaded"
  | "gateway.health";

export const GUARD_EVENT_TYPES: readonly GuardEventType[] = [
  "guard.event",
  "approval.created",
  "approval.resolved",
  "policy.reloaded",
  "gateway.health"
];

export type SseStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface SseMessage<T = unknown> {
  type: GuardEventType;
  data: T;
}

export interface SseClientOptions {
  url: string;
  onMessage: (message: SseMessage) => void;
  onStatusChange?: (status: SseStatus) => void;
  /** Cap for the exponential backoff. Default 30s. */
  maxRetryDelayMs?: number;
  withCredentials?: boolean;
}

export interface SseClient {
  close: () => void;
}

export function createSseClient(options: SseClientOptions): SseClient {
  const maxDelay = options.maxRetryDelayMs ?? 30_000;
  const withCredentials = options.withCredentials ?? true;

  let source: EventSource | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const setStatus = (status: SseStatus) => options.onStatusChange?.(status);

  const connect = () => {
    if (closed) return;
    setStatus(attempt === 0 ? "connecting" : "reconnecting");
    source = new EventSource(options.url, { withCredentials });

    source.onopen = () => {
      attempt = 0;
      setStatus("open");
    };

    for (const type of GUARD_EVENT_TYPES) {
      source.addEventListener(type, (event) => {
        try {
          options.onMessage({ type, data: JSON.parse((event as MessageEvent).data) });
        } catch {
          /* ignore malformed payloads */
        }
      });
    }

    source.onerror = () => {
      source?.close();
      if (closed) return;
      const backoff = Math.min(maxDelay, 1_000 * 2 ** attempt);
      const jitter = Math.floor(Math.random() * 300);
      attempt += 1;
      setStatus("reconnecting");
      timer = setTimeout(connect, backoff + jitter);
    };
  };

  connect();

  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      source?.close();
      setStatus("closed");
    }
  };
}
