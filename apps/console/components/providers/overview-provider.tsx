"use client";

import { createContext, useContext, type ReactNode } from "react";
import { getOverview } from "@/lib/api/client";
import type { Overview } from "@/lib/api/types";
import { useResource, type Resource } from "@/lib/api/use-resource";

/** Spec §4.1 no.3: the status bar polls `GET /overview` every 10 seconds. */
const POLL_MS = 10_000;

const OverviewContext = createContext<Resource<Overview> | null>(null);

/**
 * One `/overview` poll for the whole shell. The status bar, the offline banner and the
 * SCR-101 KPI cards all read the same snapshot, so they can never disagree about whether
 * the gateway is reachable.
 */
export function OverviewProvider({ children }: { children: ReactNode }) {
  const overview = useResource((signal) => getOverview(signal), { intervalMs: POLL_MS });
  return <OverviewContext.Provider value={overview}>{children}</OverviewContext.Provider>;
}

export function useOverview(): Resource<Overview> {
  const value = useContext(OverviewContext);
  if (!value) throw new Error("useOverview must be used inside <OverviewProvider>");
  return value;
}

/** The gateway is unreachable once a request has failed and nothing has succeeded since. */
export function isOffline(overview: Resource<Overview>): boolean {
  return Boolean(overview.error) || overview.data?.status === "disconnected";
}
