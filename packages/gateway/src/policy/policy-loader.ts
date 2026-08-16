// Shared load path for Gateway boot and hot-reload (FR-POL-03 §6 step 3): both boot
// (`loadBootSnapshot`) and reload (`loadPolicySnapshot`) call the same `loadPolicyPacks()` from
// @guardmcp/policy-engine against the same `policy-packs/` root; they differ only in which errors
// are fatal to *them* — boot only cares about a `critical` error in a required pack (GMCP-14's
// existing fail-closed threshold), while a reload refuses to swap on *any* error at all (§4.4,
// stricter — a reload is optional, so there is no reason to risk a partially-broken pack set).
import { loadPolicyPacks, type LoadPolicyPacksOptions, type PackRegistry } from "@guardmcp/policy-engine";
import type { PolicySnapshot } from "./policy-store.js";

let versionCounter = 0;

function buildSnapshot(registry: PackRegistry): PolicySnapshot {
  versionCounter += 1;
  return { registry, version: String(versionCounter), loadedAt: new Date() };
}

/** Boot-time threshold (§6 step 3): only a `critical` error (missing/broken required pack) is fatal. */
export function hasCriticalError(registry: PackRegistry): boolean {
  return registry.getAllErrors().some((error) => error.level === "critical");
}

export interface BootLoadResult {
  registry: PackRegistry;
  snapshot: PolicySnapshot;
  /** `true` means the caller must fail-closed (process exit) — see `hasCriticalError`. */
  fatal: boolean;
}

/** Gateway startup (server.ts): tolerates non-critical errors, same as the pre-hot-reload CLI/lint tooling. */
export async function loadBootSnapshot(
  rootDir: string,
  options?: LoadPolicyPacksOptions
): Promise<BootLoadResult> {
  const registry = await loadPolicyPacks(rootDir, options);
  return { registry, snapshot: buildSnapshot(registry), fatal: hasCriticalError(registry) };
}

export type PolicyLoadResult =
  | { ok: true; registry: PackRegistry; snapshot: PolicySnapshot }
  // §4.4: any load error at all blocks a hot-reload swap, so `ok: false` never carries a snapshot.
  | { ok: false; registry: PackRegistry };

/** Hot-reload (policy-watcher.ts): refuses to produce a snapshot when the load has any error. */
export async function loadPolicySnapshot(
  rootDir: string,
  options?: LoadPolicyPacksOptions
): Promise<PolicyLoadResult> {
  const registry = await loadPolicyPacks(rootDir, options);
  if (registry.getAllErrors().length > 0) {
    return { ok: false, registry };
  }
  return { ok: true, registry, snapshot: buildSnapshot(registry) };
}

/** Test seam: production never resets this, but a test loading multiple snapshots in one process does. */
export function resetPolicyVersionCounter(): void {
  versionCounter = 0;
}
