"use client";

import { useDelayed } from "@/lib/api/use-resource";
import { isOffline, useOverview, useServerInventory } from "@/components/providers/overview-provider";
import { KpiCards } from "@/components/gateway/kpi-cards";
import { QuickStart } from "@/components/gateway/quick-start";
import { RecentEvents } from "@/components/gateway/recent-events";
import { ServerInventory } from "@/components/gateway/server-inventory";

/** SCR-101 Gateway Home — FR-UI-01, UI specification §5.1. */
export default function GatewayPage() {
  const overview = useOverview();
  // The same `/servers` poll the KPI cards were counted from — fetching it again here would let
  // the table and the card above it disagree about how many servers there are.
  const servers = useServerInventory();

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
    // min-h-0: without it `flex-1` lets this grow past the shell as events arrive, and the row
    // below inherits an unbounded height — so the panels' own scrollers never get a ceiling and
    // the whole screen stretches instead.
    <div data-scr="SCR-101" className="flex min-h-0 flex-1 flex-col gap-4 px-8 py-6">
      <KpiCards overview={overview.data} failed={Boolean(overview.error) && !overview.data} />
      <div className="flex min-h-0 flex-1 gap-4">
        <ServerInventory servers={registered} loading={serversPending} failed={Boolean(servers.error) && !servers.data} />
        <RecentEvents demoDisabled={offline} />
      </div>
    </div>
  );
}
