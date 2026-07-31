"use client";

import { useEffect, useRef, useState } from "react";

/** Dispatched by the dev-only scenario switcher so every resource refetches at once. */
export const RESOURCE_REFRESH_EVENT = "guardmcp:refresh";

export interface Resource<T> {
  /** Last successful payload. Kept across failures so the disconnected screen still has data. */
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  /** When `data` was last refreshed — shown in the offline banner (spec §5.1 "미연결"). */
  fetchedAt: Date | undefined;
  /**
   * When the request behind `data` was sent. Anything that happened before this is already in
   * the payload, which is what lets a live overlay tell its own stale updates from fresh ones.
   */
  requestedAt: Date | undefined;
}

export interface ResourceOptions {
  /** Re-fetch on this cadence (ms). */
  intervalMs?: number;
  /** Re-fetch whenever this changes — e.g. the selected session id for a timeline. */
  key?: string;
}

/**
 * Fetch on mount, optionally re-fetch on an interval or when `key` changes, and refetch
 * whenever the scenario switcher fires. A failed refresh keeps the previous payload and only
 * sets `error`.
 */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, options: ResourceOptions = {}): Resource<T> {
  const { intervalMs, key } = options;
  const [state, setState] = useState<Resource<T>>({
    data: undefined,
    error: undefined,
    loading: true,
    fetchedAt: undefined,
    requestedAt: undefined
  });

  // `load` is normally an inline arrow, so it must not drive the effect.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const run = async () => {
      // Stamped before the request goes out, so a consumer can tell which live updates the
      // response could not possibly have accounted for.
      const requestedAt = new Date();
      try {
        const data = await loadRef.current(controller.signal);
        if (!cancelled) setState({ data, error: undefined, loading: false, fetchedAt: new Date(), requestedAt });
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setState((previous) => ({ ...previous, error: error as Error, loading: false }));
      }
    };

    void run();
    const timer = intervalMs ? setInterval(run, intervalMs) : undefined;
    window.addEventListener(RESOURCE_REFRESH_EVENT, run);

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearInterval(timer);
      window.removeEventListener(RESOURCE_REFRESH_EVENT, run);
    };
  }, [intervalMs, key]);

  return state;
}

/**
 * True once `active` has held for `delayMs`. Skeletons are gated on this so a response that
 * arrives quickly never flashes one (spec §4.2: no skeleton under 500ms).
 */
export function useDelayed(active: boolean, delayMs = 500): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return;
    }
    const timer = setTimeout(() => setElapsed(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);

  return active && elapsed;
}
