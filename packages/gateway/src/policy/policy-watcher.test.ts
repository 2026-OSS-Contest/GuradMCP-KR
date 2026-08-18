// FR-POL-03 §4.1 (debounce), §4.4 (fail-safe), §7 (acceptance scenarios).
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onGuardBusMessage, type GuardBusMessage } from "../pipeline/events.js";
import { loadBootSnapshot, resetPolicyVersionCounter } from "./policy-loader.js";
import { PolicyStore } from "./policy-store.js";
import { createDebouncedRunner, startPolicyWatcher, type PolicyWatcherHandle } from "./policy-watcher.js";

describe("createDebouncedRunner", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("collapses a burst of schedule() calls into a single run", () => {
    const run = vi.fn();
    const runner = createDebouncedRunner(run, 300);

    runner.schedule();
    vi.advanceTimersByTime(100);
    runner.schedule();
    vi.advanceTimersByTime(100);
    runner.schedule();
    vi.advanceTimersByTime(299);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs again for a schedule() call after the previous run fired", () => {
    const run = vi.fn();
    const runner = createDebouncedRunner(run, 300);

    runner.schedule();
    vi.advanceTimersByTime(300);
    expect(run).toHaveBeenCalledTimes(1);

    runner.schedule();
    vi.advanceTimersByTime(300);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("cancel() prevents a pending run", () => {
    const run = vi.fn();
    const runner = createDebouncedRunner(run, 300);

    runner.schedule();
    runner.cancel();
    vi.advanceTimersByTime(1000);

    expect(run).not.toHaveBeenCalled();
  });

  it("flushNow() runs immediately without waiting out the delay", () => {
    const run = vi.fn();
    const runner = createDebouncedRunner(run, 300);

    runner.schedule();
    runner.flushNow();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("never overlaps a slow async run: a schedule() during an in-flight run waits for it, then re-runs", async () => {
    vi.useRealTimers();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const run = vi
      .fn()
      .mockImplementationOnce(async () => {
        order.push("first:start");
        await new Promise<void>((resolvePromise) => {
          releaseFirst = resolvePromise;
        });
        order.push("first:end");
      })
      .mockImplementationOnce(async () => {
        order.push("second:start");
      });
    const runner = createDebouncedRunner(run, 10);

    runner.schedule();
    await new Promise((r) => setTimeout(r, 30));
    expect(run).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["first:start"]);

    // Fires while the first run is still in flight — must not start a second, overlapping run.
    runner.schedule();
    await new Promise((r) => setTimeout(r, 30));
    expect(run).toHaveBeenCalledTimes(1);

    releaseFirst?.();
    await new Promise((r) => setTimeout(r, 30));

    expect(run).toHaveBeenCalledTimes(2);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
    vi.useFakeTimers();
  });
});

async function writePack(root: string, packId: string): Promise<void> {
  const packDir = join(root, packId);
  await mkdir(join(packDir, "policies"), { recursive: true });
  await writeFile(
    join(packDir, "pack.yaml"),
    `name: ${packId}\nversion: 1.0.0\ndsl_version: 1\ndefault_action: allow\nevaluation_strategy: severity-max\nextends: []\npolicies:\n  - policies/p.yaml\n`
  );
  await writePolicy(root, packId, "block");
}

async function writePolicy(root: string, packId: string, action: string): Promise<void> {
  await writeFile(
    join(root, packId, "policies", "p.yaml"),
    `id: ${packId}_p\npack: ${packId}\npriority: 100\nmatch:\n  direction: request\n  tool: read_file\naction: ${action}\nseverity: critical\n`
  );
}

async function writeBadPolicy(root: string, packId: string): Promise<void> {
  await writeFile(join(root, packId, "policies", "p.yaml"), `id: ${packId}_p\npack: ${packId}\naction: blck\n`);
}

/** Resolves on the next bus message of `type`, or rejects if none arrives within `timeoutMs`. */
function waitForBusEvent(type: GuardBusMessage["type"], timeoutMs = 3000): Promise<GuardBusMessage> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting for ${type}`));
    }, timeoutMs);
    const off = onGuardBusMessage((message) => {
      if (message.type !== type) return;
      clearTimeout(timer);
      off();
      resolvePromise(message);
    });
  });
}

describe("startPolicyWatcher (real filesystem + chokidar)", () => {
  let root: string;
  let handle: PolicyWatcherHandle | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "policy-watcher-test-"));
    resetPolicyVersionCounter();
    await writePack(root, "default");
    await writePack(root, "korean-pii");
  });

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
    await rm(root, { recursive: true, force: true });
  });

  it("reloads and swaps the store on a valid change, emitting policy.reloaded (§7 정상 반영)", async () => {
    const boot = await loadBootSnapshot(root);
    const store = new PolicyStore(boot.snapshot);
    handle = startPolicyWatcher(root, store, { activePackId: "default", debounceMs: 30 });
    await handle.ready();

    const reloaded = waitForBusEvent("policy.reloaded");
    await writePolicy(root, "default", "warn");
    const message = await reloaded;

    expect(store.getSnapshot().version).not.toBe(boot.snapshot.version);
    expect(message.data).toMatchObject({ packId: "default", policyCount: 2 });
  });

  it("keeps the previous snapshot and emits policy.reload_failed on invalid YAML, without crashing (§7 불량 YAML)", async () => {
    const boot = await loadBootSnapshot(root);
    const store = new PolicyStore(boot.snapshot);
    handle = startPolicyWatcher(root, store, { activePackId: "default", debounceMs: 30 });
    await handle.ready();

    const failed = waitForBusEvent("policy.reload_failed");
    await writeBadPolicy(root, "default");
    const message = await failed;

    expect(store.getSnapshot().version).toBe(boot.snapshot.version);
    expect(message.data).toMatchObject({ packId: "default" });
  });

  it("collapses a burst of saves into a single reload (§7 디바운스)", async () => {
    const boot = await loadBootSnapshot(root);
    const store = new PolicyStore(boot.snapshot);
    handle = startPolicyWatcher(root, store, { activePackId: "default", debounceMs: 150 });
    await handle.ready();

    let reloadedCount = 0;
    const off = onGuardBusMessage((message) => {
      if (message.type === "policy.reloaded") reloadedCount += 1;
    });

    await writePolicy(root, "default", "warn");
    await writePolicy(root, "default", "block");
    await writePolicy(root, "default", "mask_then_allow");

    // Give the (debounced) single reload time to land, then a bit more to prove a second one
    // doesn't follow.
    await new Promise((r) => setTimeout(r, 800));
    off();

    expect(reloadedCount).toBe(1);
  });

  it("refuses the reload when a manifest-declared policy file is deleted (§7 파일 삭제: chosen behavior)", async () => {
    // This repo's pack.yaml manifests always declare an explicit `policies:` list, so deleting a
    // listed file is a `manifest.policies:missing_file` load error, not a silent shrink of the
    // pack — i.e. the "택1" in FR-POL-03 §7 resolves to "treat as a failed reload" here. This is
    // manifest-dependent, not absolute: a pack with no manifest at all falls back to
    // `listYamlFilesFlat` (packRegistry.ts), which just re-lists whatever files still exist, so
    // deleting a file there silently shrinks the pack on the next successful reload instead.
    const boot = await loadBootSnapshot(root);
    const store = new PolicyStore(boot.snapshot);
    handle = startPolicyWatcher(root, store, { activePackId: "default", debounceMs: 30 });
    await handle.ready();

    const failed = waitForBusEvent("policy.reload_failed");
    await rm(join(root, "default", "policies", "p.yaml"));
    const message = await failed;

    expect(store.getSnapshot().version).toBe(boot.snapshot.version);
    expect(message.data).toMatchObject({ reason: "manifest.policies:missing_file" });
  });

  it("reloadNow() bypasses the debounce wait for an immediate, synchronous-feeling reload", async () => {
    const boot = await loadBootSnapshot(root);
    const store = new PolicyStore(boot.snapshot);
    handle = startPolicyWatcher(root, store, { activePackId: "default", debounceMs: 10_000 });
    await handle.ready();

    await writePolicy(root, "default", "warn");
    await handle.reloadNow();

    expect(store.getSnapshot().version).not.toBe(boot.snapshot.version);
  });
});
