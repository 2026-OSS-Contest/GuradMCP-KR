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
}

/**
 * Fetch on mount, optionally re-fetch on an interval, and refetch whenever the scenario
 * switcher fires. A failed refresh keeps the previous payload and only sets `error`.
 */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, intervalMs?: number): Resource<T> {
  const [state, setState] = useState<Resource<T>>({
    data: undefined,
    error: undefined,
    loading: true,
    fetchedAt: undefined
  });

  // `load` is normally an inline arrow, so it must not drive the effect.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const run = async () => {
      try {
        const data = await loadRef.current(controller.signal);
        if (!cancelled) setState({ data, error: undefined, loading: false, fetchedAt: new Date() });
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
  }, [intervalMs]);

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
