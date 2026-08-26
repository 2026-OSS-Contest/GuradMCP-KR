import { describe, expect, it } from "vitest";
import { countActivePolicies, toOverview, withInventory } from "./overview-adapter";
import type { ApiOverview, McpServer, PolicyRow } from "./types";

/**
 * A verbatim `GET /overview` body, field for field as `OverviewController.overview()` builds it.
 * The point of pinning it here is that the adapter and the mock can drift apart silently
 * otherwise — this is the only place that asserts what the *real* backend sends.
 */
const API: ApiOverview = {
  protected: true,
  gatewayCount: 1,
  activePolicyPacks: ["default", "korean-pii"],
  blockedToday: 7,
  maskedToday: 12,
  pendingApprovals: 2,
  generatedAt: "2026-08-23T08:00:00Z",
};

const server = (id: string, connected: boolean, tools: number): McpServer => ({
  id,
  name: id,
  connected,
  trust: "limited",
  tools: Array.from({ length: tools }, (_, index) => ({
    name: `${id}-tool-${index}`,
    risk: "low" as const,
    policies: [],
    snapshotStatus: {
      state: "in_sync" as const,
      snapshotCapturedAt: null,
      lastCheckedAt: null,
      pendingDiffCount: 0,
      latestDiffId: null,
    },
  })),
});

const policy = (id: string, packId: string): PolicyRow => ({
  id,
  packId,
  priority: 10,
  action: "block",
  severity: "high",
  description: id,
});

describe("toOverview", () => {
  it("renames every field the control plane names differently", () => {
    expect(toOverview(API)).toEqual({
      status: "protected",
      policies: { packs: ["default", "korean-pii"] },
      blocked24h: 7,
      maskedToday: 12,
      pendingApprovals: 2,
    });
  });

  it("reads no packs enabled as degraded, never as disconnected", () => {
    // `disconnected` means the fetch failed; a 200 that says `protected: false` means the
    // gateway answered and has nothing switched on. Conflating them would make an idle
    // gateway indistinguishable from an unreachable one.
    const idle = toOverview({ ...API, protected: false, activePolicyPacks: [] });
    expect(idle.status).toBe("degraded");
  });

  it("leaves the inventory fields absent rather than zero", () => {
    const adapted = toOverview(API);
    expect(adapted.servers).toBeUndefined();
    expect(adapted.protectedTools).toBeUndefined();
    expect(adapted.policies.active).toBeUndefined();
  });
});

describe("withInventory", () => {
  const servers = [server("a", true, 3), server("b", false, 2)];
  const policies = [policy("p1", "default"), policy("p2", "korean-pii"), policy("p3", "disabled-pack")];

  it("counts servers, disconnections and every tool behind them", () => {
    const filled = withInventory(toOverview(API), servers, undefined);
    expect(filled.servers).toEqual({ total: 2, disconnected: 1 });
    expect(filled.protectedTools).toBe(5);
  });

  it("counts only policies whose pack is enabled", () => {
    const filled = withInventory(toOverview(API), undefined, policies);
    // p3 belongs to a pack `/overview` did not list, so it is loaded but not in force.
    expect(filled.policies.active).toBe(2);
    expect(filled.policies.packs).toEqual(["default", "korean-pii"]);
  });

  it("fills each half independently", () => {
    const serversOnly = withInventory(toOverview(API), servers, undefined);
    expect(serversOnly.policies.active).toBeUndefined();

    const policiesOnly = withInventory(toOverview(API), undefined, policies);
    expect(policiesOnly.servers).toBeUndefined();
  });

  it("keeps an empty inventory distinct from an unfetched one", () => {
    const empty = withInventory(toOverview(API), [], []);
    expect(empty.servers).toEqual({ total: 0, disconnected: 0 });
    expect(empty.protectedTools).toBe(0);
    expect(empty.policies.active).toBe(0);
  });
});

describe("countActivePolicies", () => {
  it("is zero when no pack is enabled", () => {
    expect(countActivePolicies([policy("p1", "default")], [])).toBe(0);
  });
});
