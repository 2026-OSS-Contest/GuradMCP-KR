import type { ApiOverview, McpServer, Overview, PolicyRow } from "./types";

/**
 * `GET /overview` into the shape the screens read.
 *
 * The two contracts were written independently and overlap in exactly one field name, so this
 * is a rename table with three judgement calls in it. Every one of them is checkable against
 * `services/control-plane/src/main/kotlin/kr/guardmcp/controlplane/api/OverviewController.kt`:
 *
 * - **`status`.** The control plane reports a boolean, `protected = activePacks.isNotEmpty()`.
 *   That maps onto two of the console's three states; `disconnected` is not something a
 *   successful response can say, so it is left to the caller — `isOffline()` decides it from a
 *   failed fetch, which is the only thing that actually means "unreachable".
 * - **`blocked24h` ← `blockedToday`.** Not the same window. The backend truncates to local
 *   midnight, so this is "today", and the label was changed to match rather than the number.
 * - **`gatewayCount` is dropped.** It is hardcoded to 1 and counts gateways, while the console's
 *   `servers` card counts MCP servers. Carrying it across would put a 1 in a card that means
 *   something else.
 */
export function toOverview(api: ApiOverview): Overview {
  return {
    status: api.protected ? "protected" : "degraded",
    policies: { packs: api.activePolicyPacks },
    blocked24h: api.blockedToday,
    maskedToday: api.maskedToday,
    pendingApprovals: api.pendingApprovals,
  };
}

/**
 * Fills in what `/overview` does not report, from the two calls that do.
 *
 * Both arguments are optional and each fills its own fields, so a screen that has the inventory
 * but not the policy list still gets its server counts. Anything still missing stays `undefined`
 * — the cards print a dash for that, which is the honest answer, where a `0` would read as a
 * measured "none".
 */
export function withInventory(
  overview: Overview,
  servers: McpServer[] | undefined,
  policies: PolicyRow[] | undefined,
): Overview {
  return {
    ...overview,
    ...(servers && {
      servers: {
        total: servers.length,
        disconnected: servers.filter((server) => !server.connected).length,
      },
      protectedTools: servers.reduce((sum, server) => sum + server.tools.length, 0),
    }),
    policies: {
      ...overview.policies,
      ...(policies && { active: countActivePolicies(policies, overview.policies.packs) }),
    },
  };
}

/**
 * How many policies are actually in force.
 *
 * `GET /policies` lists every loaded policy, including those belonging to a **disabled** pack —
 * `PolicyStore.listPolicies()` does not filter, and only a pack can be switched off
 * (`PolicyRow.enabled`'s own note). So the count the card wants is the intersection with the
 * enabled packs `/overview` just named.
 */
export function countActivePolicies(policies: PolicyRow[], enabledPacks: string[]): number {
  const enabled = new Set(enabledPacks);
  return policies.filter((policy) => enabled.has(policy.packId)).length;
}
