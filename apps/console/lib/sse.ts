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

interface Subscriber {
  onMessage: (message: SseMessage) => void;
  onStatusChange?: (status: SseStatus) => void;
}

interface Connection {
  source: EventSource | null;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
  status: SseStatus;
  subscribers: Set<Subscriber>;
}

/**
 * One connection per URL. The status bar lives on every screen, so a second consumer would
 * otherwise add an EventSource to every page and eat into the browser's six-per-origin budget
 * on HTTP/1.1. Backoff and reconnect stay on the shared connection; each subscriber just gets
 * the messages and the status.
 */
const connections = new Map<string, Connection>();

function openConnection(url: string, maxDelay: number, withCredentials: boolean): Connection {
  const existing = connections.get(url);
  if (existing) return existing;

  const connection: Connection = { source: null, attempt: 0, timer: null, status: "connecting", subscribers: new Set() };
  connections.set(url, connection);

  const setStatus = (status: SseStatus) => {
    connection.status = status;
    for (const subscriber of connection.subscribers) subscriber.onStatusChange?.(status);
  };

  const connect = () => {
    if (!connections.has(url)) return;
    setStatus(connection.attempt === 0 ? "connecting" : "reconnecting");
    const source = new EventSource(url, { withCredentials });
    connection.source = source;

    source.onopen = () => {
      connection.attempt = 0;
      setStatus("open");
    };

    for (const type of GUARD_EVENT_TYPES) {
      source.addEventListener(type, (event) => {
        let data: unknown;
        try {
          data = JSON.parse((event as MessageEvent).data);
        } catch {
          return; // ignore malformed payloads
        }
        for (const subscriber of connection.subscribers) subscriber.onMessage({ type, data });
      });
    }

    source.onerror = () => {
      source.close();
      if (!connections.has(url)) return;
      const backoff = Math.min(maxDelay, 1_000 * 2 ** connection.attempt);
      const jitter = Math.floor(Math.random() * 300);
      connection.attempt += 1;
      setStatus("reconnecting");
      connection.timer = setTimeout(connect, backoff + jitter);
    };
  };

  connect();
  return connection;
}

export function createSseClient(options: SseClientOptions): SseClient {
  // The first subscriber's tuning wins; every consumer in the console passes the same values.
  const connection = openConnection(options.url, options.maxRetryDelayMs ?? 30_000, options.withCredentials ?? true);
  const subscriber: Subscriber = { onMessage: options.onMessage, onStatusChange: options.onStatusChange };
  connection.subscribers.add(subscriber);
  // A late subscriber would otherwise sit on its initial status until the next transition.
  options.onStatusChange?.(connection.status);

  return {
    close() {
      connection.subscribers.delete(subscriber);
      options.onStatusChange?.("closed");
      if (connection.subscribers.size > 0) return;
      // Last one out tears the connection down, so a screen that stops listening stops the socket.
      connections.delete(options.url);
      if (connection.timer) clearTimeout(connection.timer);
      connection.source?.close();
    }
  };
}
