// File-watch + debounce + atomic-swap orchestration for policy hot-reload (FR-POL-03 §4.1/§4.4).
//
// `add`/`change`/`unlink` anywhere under `policy-packs/**/*.{yaml,yml}` are all treated as "reload
// everything" (§4.1 — policy packs are always re-read as a whole, never diffed/merged), and a
// burst of edits within `debounceMs` collapses into a single reload (§4.1/§7 "디바운스" scenario).
import { watch, type FSWatcher } from "chokidar";
import type { PolicyLoadError } from "@guardmcp/policy-engine";
import { syncPolicyRegistry } from "../controlPlane/policySync.js";
import { emitPolicyReloadFailed, emitPolicyReloaded } from "../pipeline/events.js";
import { logJson } from "../pipeline/logger.js";
import { loadPolicySnapshot } from "./policy-loader.js";
import type { PolicyStore } from "./policy-store.js";

const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Collapses any number of `schedule()` calls arriving within `delayMs` of each other into one
 * `run` invocation. Kept independent of chokidar so it's unit-testable with fake timers instead
 * of real filesystem events.
 *
 * Also serializes `run()` itself: at most one call is ever in flight, and at most one more is
 * queued behind it (further triggers while both are outstanding just join that same queued
 * call — a depth-1 coalesced queue, not an unbounded one). Without this, a burst of file events
 * arriving faster than a slow `run()` (e.g. disk I/O) could start a second overlapping call, and
 * since a snapshot's version is stamped at load *completion* (see `buildSnapshot` in
 * policy-loader.ts), completion order — not start order — decides which one wins the swap. An
 * older, slower load finishing after a newer, faster one would then roll the active policy back
 * to stale state. Serializing removes the overlap entirely; the queued trailing call still
 * re-reads current state after the in-flight one settles, so a request never gets silently
 * dropped, only coalesced.
 */
export function createDebouncedRunner(run: () => void | Promise<void>, delayMs = DEFAULT_DEBOUNCE_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let queued: Promise<void> | null = null;

  function invoke(): Promise<void> {
    const result = run();
    if (!result || typeof (result as Promise<void>).then !== "function") {
      // A synchronous run already fully happened above (used by unit tests) — no in-flight
      // window to guard, so don't hold `inFlight` open for it.
      return Promise.resolve();
    }
    const settle = (error?: unknown): void => {
      inFlight = null;
      if (error !== undefined) {
        // Never let a rejection propagate as an unhandled rejection or, worse, wedge the runner
        // (a rejected `inFlight`/`queued` would otherwise never resolve, permanently silencing
        // every later trigger()). The real `run()` here (policy reload) already reports its own
        // failures via events/logging and resolves normally — this only guards an unexpected throw.
        console.error("[createDebouncedRunner] run() rejected:", error);
      }
    };
    inFlight = (result as Promise<void>).then(
      () => settle(),
      (error: unknown) => settle(error)
    );
    return inFlight;
  }

  function trigger(): Promise<void> {
    if (!inFlight) return invoke();
    if (!queued) {
      const waitFor = inFlight;
      const runQueued = (): Promise<void> => {
        queued = null;
        return invoke();
      };
      queued = waitFor.then(runQueued, runQueued);
    }
    return queued;
  }

  return {
    schedule(): void {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void trigger();
      }, delayMs);
    },
    /** Test/reloadNow seam: run immediately (joining a run already in flight/queued), bypassing the debounce wait. */
    flushNow(): Promise<void> {
      if (timer) clearTimeout(timer);
      timer = null;
      return trigger();
    },
    cancel(): void {
      if (timer) clearTimeout(timer);
      timer = null;
    }
  };
}

export interface PolicyWatcherOptions {
  /** The pack the pipeline actually evaluates — reported as `packId` on a successful reload event. */
  activePackId: string;
  debounceMs?: number;
  /** Forwarded to `loadPolicySnapshot` — a test fixture rarely has the production required packs. */
  requiredPacks?: string[];
  /** Set to push the freshly reloaded registry to the Control Plane (fix-api.md §1); omitted in tests. */
  controlPlaneUrl?: string | undefined;
}

export interface PolicyWatcherHandle {
  close(): Promise<void>;
  /** Test seam: forces an immediate reload, bypassing both the debounce wait and real FS events. */
  reloadNow(): Promise<void>;
  /**
   * Resolves once chokidar's initial directory scan completes. Production never awaits this (the
   * watcher runs for the process's whole lifetime, so a race in its first few milliseconds is
   * not a real concern) — it exists so a test can avoid mutating a file before the watcher has
   * actually started tracking it, which is a real race, not a chokidar quirk: on some
   * platforms/backends a delete that lands before the initial scan finishes is silently missed.
   */
  ready(): Promise<void>;
}

/** Root-level errors aren't tied to a pack; otherwise report whichever pack owns the first error. */
function firstError(registry: {
  getRootErrors(): PolicyLoadError[];
  listPacks(): { packId: string; errors: PolicyLoadError[] }[];
}): { error: PolicyLoadError; packId?: string } | undefined {
  const [rootError] = registry.getRootErrors();
  if (rootError) return { error: rootError };
  for (const pack of registry.listPacks()) {
    const [error] = pack.errors;
    if (error) return { error, packId: pack.packId };
  }
  return undefined;
}

export function startPolicyWatcher(
  rootDir: string,
  store: PolicyStore,
  options: PolicyWatcherOptions
): PolicyWatcherHandle {
  const reload = async (): Promise<void> => {
    const result = await loadPolicySnapshot(
      rootDir,
      options.requiredPacks ? { requiredPacks: options.requiredPacks } : undefined
    );
    if (!result.ok) {
      const errors = result.registry.getAllErrors();
      logJson("error", "policy reload failed; keeping previous snapshot", {
        errorCount: errors.length,
        errors: errors.map(({ file, ruleId, message }) => ({ file, ruleId, message }))
      });
      const failing = firstError(result.registry);
      emitPolicyReloadFailed({
        packId: failing?.packId ?? options.activePackId,
        filePath: failing?.error.file ?? rootDir,
        reason: failing?.error.ruleId ?? "unknown",
        detail: failing?.error.message ?? "정책 재로드에 실패했습니다.",
        occurredAt: new Date().toISOString()
      });
      return;
    }

    store.swap(result.snapshot);
    const policyCount = result.registry.getActivePolicyCount();
    logJson("info", "policy reloaded", { version: result.snapshot.version, policyCount });
    syncPolicyRegistry(options.controlPlaneUrl, result.registry);
    emitPolicyReloaded({
      packId: options.activePackId,
      version: result.snapshot.version,
      reloadedAt: result.snapshot.loadedAt.toISOString(),
      policyCount
    });
  };

  const runner = createDebouncedRunner(reload, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);

  // `awaitWriteFinish` guards against reading a file mid-write (an editor's save is rarely a
  // single atomic syscall); the debounce above is the separate, coarser guard against a burst of
  // distinct save events (e.g. an editor's backup-file churn) triggering more than one reload.
  //
  // chokidar v4 dropped glob support (https://github.com/paulmillr/chokidar#upgrading), so
  // `policy-packs/**/*.{yaml,yml}` isn't a valid target anymore — watch the root recursively and
  // filter to YAML files (and always let directories through, or their contents never surface).
  const watcher: FSWatcher = watch(rootDir, {
    ignoreInitial: true,
    ignored: (path, stats) => stats?.isFile() === true && !/\.ya?ml$/.test(path),
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 }
  });
  watcher.on("add", () => runner.schedule());
  watcher.on("change", () => runner.schedule());
  watcher.on("unlink", () => runner.schedule());
  watcher.on("error", (error: unknown) => {
    logJson("error", "policy watcher error", { message: error instanceof Error ? error.message : String(error) });
  });
  const readyPromise = new Promise<void>((resolvePromise) => watcher.once("ready", () => resolvePromise()));

  return {
    async close() {
      runner.cancel();
      await watcher.close();
    },
    async reloadNow() {
      // Routes through the runner (not a direct `reload()` call) so it joins the same in-flight/
      // queued serialization as watcher-triggered reloads instead of racing one.
      await runner.flushNow();
    },
    ready() {
      return readyPromise;
    }
  };
}
