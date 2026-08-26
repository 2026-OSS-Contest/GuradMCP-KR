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
  /** Whether this URL has ever answered with a stream. See `COLD_ATTEMPT_LIMIT`. */
  everOpened: boolean;
}

/**
 * How many times to try a URL that has **never** answered before giving up on it.
 *
 * The distinction matters: a stream that opened once and then dropped is a live console losing
 * its backend, and it should keep reaching for it for as long as the screen is open. A stream
 * that has never opened is almost always a build with no event source behind it at all — and
 * `EventSource` cannot tell "connection refused" from "404 with an HTML body", so both arrive
 * here as the same `onerror`.
 *
 * That case became reachable when the four call sites dropped their `MOCK_API ? … : null` guard
 * for an always-relative URL (fix-api.md §2, so the `CONTROL_PLANE_URL` rewrite is used when it
 * is configured). Without CONTROL_PLANE_URL and without MSW — a Vercel deploy, `next dev` with
 * mocks off — `/api/v1/events/stream` is a Next.js 404 page, and the backoff below then hammered
 * it at the 30s cap for the lifetime of the tab. Five attempts spans ~31s of real backoff, which
 * is long enough to ride out a control plane that is still starting up.
 */
const COLD_ATTEMPT_LIMIT = 5;

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

  const connection: Connection = {
    source: null,
    attempt: 0,
    timer: null,
    status: "connecting",
    subscribers: new Set(),
    everOpened: false
  };
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
      connection.everOpened = true;
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
      // Give up on a URL that has never answered, rather than retrying it for the life of the
      // tab. `closed` is a terminal status here: subscribers that want another go have to build
      // a new client, which is what a remount does.
      if (!connection.everOpened && connection.attempt + 1 >= COLD_ATTEMPT_LIMIT) {
        connection.source = null;
        connections.delete(url);
        setStatus("closed");
        return;
      }
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
      // Only if the map still holds *this* connection: a cold-limit give-up (above) already
      // dropped it, and a remount since then will have registered a live replacement under the
      // same URL — deleting by key alone would tear that one down instead.
      if (connections.get(options.url) === connection) connections.delete(options.url);
      if (connection.timer) clearTimeout(connection.timer);
      connection.source?.close();
    }
  };
}
