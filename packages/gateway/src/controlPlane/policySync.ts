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

export function syncPolicyRegistry(baseUrl: string | undefined, registry: PackRegistry): void {
  if (!baseUrl) return;
  const packs = registry.listPacks();
  void fetch(new URL("/api/v1/policies/sync", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
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
