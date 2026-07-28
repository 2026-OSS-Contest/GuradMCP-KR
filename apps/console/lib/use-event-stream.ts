"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSseClient, type GuardEventType, type SseStatus } from "@/lib/sse";
import { mergeEvents } from "@/lib/merge-events";

/**
 * Live event stream for a console screen (UI spec §6.3), reusable across SCR-101/201/301/402.
 *
 * It seeds from a one-shot fetch, then keeps the list live over SSE — new events land on top.
 * When the connection drops and comes back (a gateway restart, a network blip) it re-runs the
 * same fetch to backfill whatever was missed while disconnected, so recovery loses no events.
 * Freshly-arrived ids are reported in `fresh` for the insert tint; each clears after `freshMs`.
 */
export interface EventStreamOptions<T> {
  /** SSE endpoint. `null` disables the live stream (no mock and no backend to connect to). */
  streamUrl: string | null;
  /** Seed fetch, re-run on recovery to close gaps — e.g. `GET /events/recent`. */
  backfill?: (signal: AbortSignal) => Promise<T[]>;
  /** Stable identity, used to de-duplicate a streamed event against its polled copy. */
  getId: (item: T) => string;
  /** Sort key (higher = newer). Without it the list keeps newest-first insertion order. */
  getTime?: (item: T) => number;
  /** Which named SSE event carries `T`. Default `guard.event`. */
  eventType?: GuardEventType;
  /** Map the raw SSE payload to `T`. Default: the payload is already `T`. */
  select?: (data: unknown) => T;
  /** Cap the retained buffer. Default 20. */
  max?: number;
  /** How long an id stays in `fresh` after arriving. Default 1500ms (spec: 1.5s tint). */
  freshMs?: number;
}

export interface EventStream<T> {
  events: T[];
  status: SseStatus;
  /** Ids that arrived within the last `freshMs` — drives the insert tint. */
  fresh: ReadonlySet<string>;
  /** The seed fetch has not resolved yet. */
  loading: boolean;
  /** The seed fetch failed and nothing has ever loaded — there is no stale data to show. */
  failed: boolean;
  /** When the list last refreshed from a fetch or a streamed event. */
  fetchedAt: Date | undefined;
}

const EMPTY_FRESH: ReadonlySet<string> = new Set();

export function useEventStream<T>(options: EventStreamOptions<T>): EventStream<T> {
  const { streamUrl } = options;

  const [events, setEvents] = useState<T[]>([]);
  const [status, setStatus] = useState<SseStatus>(streamUrl ? "connecting" : "closed");
  const [fresh, setFresh] = useState<ReadonlySet<string>>(EMPTY_FRESH);
  const [loading, setLoading] = useState(Boolean(options.backfill));
  const [failed, setFailed] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<Date | undefined>(undefined);

  // Inline callbacks and config change every render; keep them off the effect deps.
  const cfg = useRef(options);
  cfg.current = options;

  const seen = useRef(new Set<string>());
  const freshTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pollAbort = useRef<AbortController | null>(null);
  // True once the connection has dropped, so the next "open" is a recovery to backfill from.
  const dropped = useRef(false);

  const markFresh = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const freshMs = cfg.current.freshMs ?? 1500;
    setFresh((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    for (const id of ids) {
      clearTimeout(freshTimers.current.get(id));
      freshTimers.current.set(
        id,
        setTimeout(() => {
          freshTimers.current.delete(id);
          setFresh((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }, freshMs)
      );
    }
  }, []);

  // Merge newest-first and de-duplicate (see mergeEvents). `tint` marks genuinely new ids — ones
  // not seen before — so the seed load does not flash the whole list, only live arrivals do.
  const merge = useCallback(
    (incoming: T[], tint: boolean) => {
      if (!incoming.length) return;
      const { getId, getTime, max = 20 } = cfg.current;

      if (tint) {
        markFresh(incoming.map(getId).filter((id) => !seen.current.has(id)));
      }
      for (const item of incoming) seen.current.add(getId(item));

      setEvents((prev) => mergeEvents(prev, incoming, { getId, getTime, max }));
      setFetchedAt(new Date());
    },
    [markFresh]
  );

  const runBackfill = useCallback(
    (tint: boolean) => {
      const backfill = cfg.current.backfill;
      if (!backfill) {
        setLoading(false);
        return;
      }
      pollAbort.current?.abort();
      const controller = new AbortController();
      pollAbort.current = controller;
      backfill(controller.signal)
        .then((items) => {
          if (controller.signal.aborted) return;
          merge(items, tint);
          setFailed(false);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    },
    [merge]
  );

  // Seed once on mount. The recovery path re-runs the same fetch through `runBackfill`.
  useEffect(() => {
    runBackfill(false);
    return () => pollAbort.current?.abort();
  }, [runBackfill]);

  // Live stream. A drop→open transition is a recovery: re-poll to backfill the gap.
  useEffect(() => {
    if (!streamUrl) {
      setStatus("closed");
      return;
    }
    const client = createSseClient({
      url: streamUrl,
      onStatusChange: (next) => {
        setStatus(next);
        if (next === "reconnecting") dropped.current = true;
        else if (next === "open" && dropped.current) {
          dropped.current = false;
          runBackfill(true);
        }
      },
      onMessage: (message) => {
        if (message.type !== (cfg.current.eventType ?? "guard.event")) return;
        const select = cfg.current.select ?? ((data: unknown) => data as T);
        merge([select(message.data)], true);
      }
    });
    return () => client.close();
  }, [streamUrl, merge, runBackfill]);

  // Drop pending tint timers on unmount.
  useEffect(() => {
    const timers = freshTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return { events, status, fresh, loading, failed, fetchedAt };
}
