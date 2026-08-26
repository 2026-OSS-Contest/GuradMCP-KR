// Gateway -> Control Plane policy registry push (docs/task-docs/fix-api/fix-api.md §1,
// option B). `packages/policy-engine`'s loader is the only place that parses `policy-packs/`;
// rather than duplicating that parser in Kotlin, the Gateway — which already loads the real
// pack set for its own pipeline (FR-POL-03 §3/§6) — reports what it loaded to the Control Plane
// after every successful boot/hot-reload. `PolicyStore` on that side then serves the console's
// `GET /policies`/`GET /policy-packs` from this pushed state instead of a hardcoded seed.
//
// Fire-and-forget, same as `reportToolObservation` (tool-snapshot-registry.ts): a verdict must
// never block on this, and a Control Plane outage during a reload must not roll back or retry —
// the next successful reload (or the debounced watcher's next tick) carries the same state again.
import type { PackRegistry, PackState } from "@guardmcp/policy-engine";

/**
 * `syncToken`: the shared secret `security.sync-token` (`POLICY_SYNC_TOKEN`) on the Control
 * Plane side gates this write with — see that service's `PolicyController.sync` doc. Sent as
 * `X-Sync-Token`, same header name/shared-secret shape as the console's reveal proxy already
 * uses for `X-Operator-Token`. Omitted (no header at all) when unset, which the Control Plane
 * denies by default rather than accepting an unauthenticated sync.
 */
export function syncPolicyRegistry(baseUrl: string | undefined, registry: PackRegistry, syncToken?: string | undefined): void {
  if (!baseUrl) return;
  const packs = registry.listPacks();
  void fetch(new URL("/api/v1/policies/sync", baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(syncToken ? { "X-Sync-Token": syncToken } : {}),
    },
    body: JSON.stringify({
      syncedAt: new Date().toISOString(),
      packs: packs.map((pack) => ({
        packId: pack.packId,
        name: pack.name,
        description: pack.description ?? "",
        enabled: pack.enabled,
      })),
      policies: packs.flatMap((pack) => pack.policies.map((policy) => {
        const source = findSource(pack, policy.id);
        return {
          id: policy.id,
          packId: pack.packId,
          priority: policy.priority,
          action: policy.action,
          severity: policy.severity,
          description: policy.description ?? "",
          direction: policy.match.direction ?? "any",
          message: policy.message ?? "",
          enabled: policy.enabled !== false,
          sourcePath: source?.filePath ?? "",
          sourceYaml: source?.sourceText ?? "",
          dryRun: policy.dry_run === true,
        };
      })),
    }),
  }).catch((error) => {
    process.stdout.write(`${JSON.stringify({ level: "warn", service: "gateway", message: "policy-sync report failed", error: String(error) })}\n`);
  });
}

function findSource(pack: PackState, policyId: string) {
  return pack.policySources.find((source) => source.policyId === policyId);
}
