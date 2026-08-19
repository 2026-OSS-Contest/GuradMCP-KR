// Atomic snapshot store for hot-reloadable policy packs (FR-POL-03 §4.3).
//
// `swap()` is a single reference assignment — atomic in the Node.js event loop — so a request
// that already read a snapshot via `getSnapshot()` keeps evaluating against it even if a reload
// swaps `current` to a newer one mid-request. The pipeline must call `getSnapshot()` once per
// evaluation and thread the result through rather than re-reading it partway through (see
// server.ts's `evaluatePayloadOrThrow`, which is synchronous end-to-end for exactly this reason).
import type { PackRegistry } from "@guardmcp/policy-engine";

export interface PolicySnapshot {
  registry: PackRegistry;
  /** Monotonically increasing per successful load (FR-POL-03 §4.3's counter option). */
  version: string;
  loadedAt: Date;
}

export class PolicyStore {
  private current: PolicySnapshot;

  constructor(initial: PolicySnapshot) {
    this.current = initial;
  }

  getSnapshot(): PolicySnapshot {
    return this.current;
  }

  swap(next: PolicySnapshot): void {
    this.current = next;
  }
}
