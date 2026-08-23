"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { getOverview, getPolicies, getServers } from "@/lib/api/client";
import { withInventory } from "@/lib/api/overview-adapter";
import type { Overview, PolicyRow, ServersResponse } from "@/lib/api/types";
import { useResource, type Resource } from "@/lib/api/use-resource";

/** Spec §4.1 no.3: the status bar polls `GET /overview` every 10 seconds. */
const POLL_MS = 10_000;

interface OverviewValue {
  overview: Resource<Overview>;
  servers: Resource<ServersResponse>;
}

const OverviewContext = createContext<OverviewValue | null>(null);

/**
 * One snapshot of "what is the gateway doing" for the whole shell.
 *
 * It takes three calls rather than one because `/overview` does not report the MCP inventory or
 * a policy count — it counts *gateways* (hardcoded 1) and names the enabled packs, and nothing
 * else (`OverviewController.kt`). The console's server, tool and policy cards therefore have to
 * be derived, and the shell needs the server count too: the status bar blanks itself on the home
 * route while nothing is registered, because 보호 중 over an empty inventory is a false claim.
 *
 * `/servers` is polled alongside `/overview` so a trust change or a dropped upstream shows up in
 * the same beat as the rest of the bar. `/policies` is fetched once — the list only changes when
 * a pack is toggled or the gateway re-syncs, and re-reading every policy on a 10-second timer to
 * maintain one number on one card is not worth the request.
 *
 * The inventory is exposed as well, so SCR-101 renders its table from the same response the
 * cards were counted from instead of fetching `/servers` a second time.
 */
export function OverviewProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const overview = useResource((signal) => getOverview(signal), { intervalMs: POLL_MS });
  // Keyed on the route as well as the timer: arriving on a screen is exactly when the inventory
  // has to be right, and waiting out the poll would show a trust change made on SCR-501 as the
  // old value for up to ten seconds. This is the mount-time refetch SCR-101 used to do for
  // itself, kept now that the fetch lives here.
  const servers = useResource((signal) => getServers(signal), { intervalMs: POLL_MS, key: pathname });
  const policies = useResource<PolicyRow[]>((signal) => getPolicies(signal));

  const value = useMemo<OverviewValue>(
    () => ({
      overview: {
        ...overview,
        data: overview.data
          ? withInventory(overview.data, servers.data?.servers, policies.data)
          : undefined,
      },
      servers,
    }),
    [overview, servers, policies.data],
  );

  return <OverviewContext.Provider value={value}>{children}</OverviewContext.Provider>;
}

function useOverviewContext(): OverviewValue {
  const value = useContext(OverviewContext);
  if (!value) throw new Error("useOverview must be used inside <OverviewProvider>");
  return value;
}

export function useOverview(): Resource<Overview> {
  return useOverviewContext().overview;
}

/** The `/servers` poll the cards were counted from, for the screen that also tabulates it. */
export function useServerInventory(): Resource<ServersResponse> {
  return useOverviewContext().servers;
}

/** The gateway is unreachable once a request has failed and nothing has succeeded since. */
export function isOffline(overview: Resource<Overview>): boolean {
  return Boolean(overview.error) || overview.data?.status === "disconnected";
}
