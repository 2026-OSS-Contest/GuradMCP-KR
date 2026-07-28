"use client";

import { getServers } from "@/lib/api/client";
import { useDelayed, useResource } from "@/lib/api/use-resource";
import { isOffline, useOverview } from "@/components/providers/overview-provider";
import { KpiCards } from "@/components/gateway/kpi-cards";
import { QuickStart } from "@/components/gateway/quick-start";
import { RecentEvents } from "@/components/gateway/recent-events";
import { ServerInventory } from "@/components/gateway/server-inventory";

/** SCR-101 Gateway Home — FR-UI-01, UI specification §5.1. */
export default function GatewayPage() {
  const overview = useOverview();
  const servers = useResource((signal) => getServers(signal));

  // Spec §4.2: a response under 500ms must not flash a skeleton.
  const serversPending = useDelayed(!servers.data);

  const registered = servers.data?.servers ?? [];
  const offline = isOffline(overview);

  // Empty state only once we know the inventory is genuinely empty — never while loading and
  // never on a failed poll, where the last known servers are still the best answer.
  if (servers.data && registered.length === 0) {
    return (
      <div data-scr="SCR-101" className="flex flex-1 flex-col px-8 py-6">
        <QuickStart policyPacks={overview.data?.policies.packs ?? []} />
      </div>
    );
  }

  return (
    <div data-scr="SCR-101" className="flex flex-1 flex-col gap-4 px-8 py-6">
      <KpiCards overview={overview.data} failed={Boolean(overview.error) && !overview.data} />
      <div className="flex min-h-0 flex-1 gap-4">
        <ServerInventory servers={registered} loading={serversPending} failed={Boolean(servers.error) && !servers.data} />
        <RecentEvents demoDisabled={offline} />
      </div>
    </div>
  );
}
