// Keeps the gateway's local copy of each server's approved tool-definition baseline in
// sync with the Control Plane, and reports drift observations back (FR-GW-03).
//
// Mirrors server-registry.ts's shape deliberately: a verdict-adjacent decision (here,
// "is this tools/list response drifted from what was approved") must never block on a
// live Control Plane round-trip, so the baseline is a background-synced local cache with
// a fail-safe default, not a per-request fetch.
import type { ToolDefinitionDiff, ToolSnapshotBaselineEntry } from "./tool-snapshot.js";

interface BaselineState {
  /** False when the Control Plane has no active `ToolSnapshot` for this server yet — the
   *  server is "미승인" (spec §5.1.3) and must be excluded from diffing entirely, not
   *  diffed against an empty baseline (which would read every tool as newly added). */
  approved: boolean;
  entries: ToolSnapshotBaselineEntry[];
}

const unapproved: BaselineState = { approved: false, entries: [] };

const cache = new Map<string, BaselineState>();

/** Fail-safe default: a server never synced, or synced and found to have no active
 *  snapshot, both read as unapproved — diffing is skipped for either (spec §5.1.3, §5.3). */
export function getToolSnapshotBaseline(serverId: string): BaselineState {
  return cache.get(serverId) ?? unapproved;
}

export function replaceToolSnapshotBaseline(serverId: string, state: BaselineState): void {
  cache.set(serverId, state);
}

/** Test-only reset. */
export function clearToolSnapshotRegistry(): void {
  cache.clear();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses the Control Plane's `GET /servers/{id}/tool-snapshot` body. Returns `undefined`
 *  for a malformed response so one bad fetch cannot wipe a good cached baseline. */
export function parseBaselineResponse(raw: string): BaselineState | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || typeof parsed.approved !== "boolean" || !Array.isArray(parsed.tools)) return undefined;
  const entries: ToolSnapshotBaselineEntry[] = [];
  for (const entry of parsed.tools) {
    if (
      isRecord(entry) &&
      typeof entry.toolName === "string" &&
      typeof entry.description === "string" &&
      typeof entry.fingerprint === "string"
    ) {
      entries.push({
        toolName: entry.toolName,
        description: entry.description,
        inputSchema: entry.inputSchema ?? null,
        fingerprint: entry.fingerprint,
      });
    }
  }
  return { approved: parsed.approved, entries };
}

export interface ToolSnapshotSync {
  stop(): void;
}

const defaultIntervalMs = 60_000;

/**
 * Background poll of the Control Plane's active tool-snapshot baseline (spec §5.1 —
 * feeds the comparison in §5.2). A poll rather than the SSE push `server-registry.ts`
 * uses for trust: the drift check itself only ever runs synchronously inside the
 * `tools/list` request path (there is no persistent MCP client connection to receive
 * `notifications/tools/list_changed` on, and no background poll of the *upstream*
 * server — see tool-snapshot-registry.test.ts and server.ts for where the comparison
 * actually happens), so the baseline only needs to be "recent enough," not pushed
 * instantly.
 */
export function startToolSnapshotSync(
  baseUrl: string | undefined,
  serverId: string,
  intervalMs = defaultIntervalMs,
): ToolSnapshotSync {
  if (!baseUrl) {
    // A security control silently off is worse than one silently misconfigured: without
    // this line, a missing CONTROL_PLANE_URL and a genuinely unapproved server look
    // identical from the logs — both just never produce drift GuardEvents.
    process.stdout.write(`${JSON.stringify({ level: "warn", service: "gateway", message: "CONTROL_PLANE_URL unset; tool-snapshot drift detection disabled" })}\n`);
    return { stop() {} };
  }
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const fetchOnce = async (): Promise<void> => {
    try {
      const response = await fetch(new URL(`/api/v1/servers/${serverId}/tool-snapshot`, baseUrl));
      if (!response.ok) throw new Error(`tool-snapshot fetch returned ${response.status}`);
      const state = parseBaselineResponse(await response.text());
      if (state) replaceToolSnapshotBaseline(serverId, state);
    } catch (error) {
      // Fail-open on the last good cache (same rationale as server-registry.ts): a
      // transient Control Plane outage keeps the last-synced baseline rather than
      // falling back to "unapproved," which would silently stop drift detection.
      process.stdout.write(`${JSON.stringify({ level: "warn", service: "gateway", message: "tool-snapshot sync failed", error: String(error) })}\n`);
    }
  };

  const loop = async (): Promise<void> => {
    while (!stopped) {
      await fetchOnce();
      if (stopped) return;
      await delay(intervalMs, (handle) => {
        timer = handle;
      });
    }
  };

  void loop();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

function delay(ms: number, onSchedule: (handle: ReturnType<typeof setTimeout>) => void): Promise<void> {
  return new Promise((resolve) => {
    onSchedule(setTimeout(resolve, ms));
  });
}

/**
 * Reports a `tools/list` observation — the raw tool list plus any diffs detected against
 * the local baseline — to the Control Plane for persistence (spec §6.2/§6.3 query surface,
 * `lastCheckedAt`). Fire-and-forget: the primary audit trail is the GuardEvent already
 * emitted through the normal pipeline (auditPublisher.ts's bounded, best-effort queue), so
 * losing this supplementary report to a transient Control Plane outage does not lose the
 * drift record itself — only the console's live tool-inventory view lags until the next
 * successful report.
 */
export function reportToolObservation(
  baseUrl: string | undefined,
  serverId: string,
  tools: readonly { name: string; description: string; inputSchema: unknown; fingerprint: string }[],
  diffs: readonly ToolDefinitionDiff[],
): void {
  if (!baseUrl) return;
  void fetch(new URL(`/api/v1/servers/${serverId}/tool-observations`, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      observedAt: new Date().toISOString(),
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        fingerprint: tool.fingerprint,
      })),
      diffs,
    }),
  }).catch((error) => {
    process.stdout.write(`${JSON.stringify({ level: "warn", service: "gateway", message: "tool-observation report failed", error: String(error) })}\n`);
  });
}
