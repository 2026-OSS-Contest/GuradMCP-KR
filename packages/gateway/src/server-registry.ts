import type { ServerTrust } from "./risk.js";

export type { ServerTrust };

export interface ServerRecord {
  id: string;
  trustLevel: ServerTrust;
}

const cache = new Map<string, ServerTrust>();

/**
 * Pipeline step ① (FR-GW-02 §4.1): resolves the target server's trust grade for the Risk Scorer
 * and Policy Engine. Fail-safe — an unknown server id (never synced, or synced then evicted by a
 * later snapshot that no longer lists it) always reads as `untrusted` rather than inheriting
 * whatever grade happened to be cached before, matching NFR-03 fail-closed.
 */
export function getServerTrust(serverId: string): ServerTrust {
  return cache.get(serverId) ?? "untrusted";
}

/** Replaces the whole cache with a fresh snapshot from the Control Plane. */
export function replaceServerRegistry(records: ServerRecord[]): void {
  cache.clear();
  for (const record of records) cache.set(record.id, record.trustLevel);
}

/** Test-only reset; production code never needs to empty the cache without a snapshot to replace it. */
export function clearServerRegistry(): void {
  cache.clear();
}

export interface ServerRegistrySync {
  stop(): void;
}

const trustGrades: readonly ServerTrust[] = ["trusted", "limited", "untrusted"];

function isServerTrust(value: unknown): value is ServerTrust {
  return trustGrades.some((grade) => grade === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses one `servers.snapshot` SSE frame's `{ servers: [...] }` payload (§api ServerSummary).
 * Returns `undefined` for a malformed frame — distinct from `[]`, a genuinely empty registry —
 * so the caller can discard a corrupt frame instead of wiping every cached grade over it (a
 * `replaceServerRegistry([])` would fail every server safe to `untrusted`, which is the right
 * call for a real empty registry but not for one bad frame on the wire).
 */
export function parseServersSnapshot(raw: string): ServerRecord[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.servers)) return undefined;
  const records: ServerRecord[] = [];
  for (const entry of parsed.servers) {
    if (isRecord(entry) && typeof entry.id === "string" && isServerTrust(entry.trust)) {
      records.push({ id: entry.id, trustLevel: entry.trust });
    }
  }
  return records;
}

/**
 * Keeps the local trust cache aligned with the Control Plane's server registry (§4.1, §5.1).
 * A verdict never blocks on a live Control Plane round-trip — it always reads the local cache —
 * so this runs independently in the background and reconnects with backoff on failure. Pushes
 * (not a poll interval) carry downgrades to the gateway immediately, the same immediacy §5.1
 * requires of the Control Plane's own cache-invalidation signal.
 */
export function startServerRegistrySync(baseUrl: string | undefined): ServerRegistrySync {
  if (!baseUrl) return { stop() {} };
  const controller = new AbortController();
  let stopped = false;

  const connect = async (): Promise<void> => {
    let attempt = 0;
    while (!stopped) {
      try {
        const response = await fetch(new URL("/api/v1/servers/stream", baseUrl), {
          headers: { accept: "text/event-stream" },
          signal: controller.signal
        });
        if (!response.ok || !response.body) throw new Error(`Server-registry stream returned ${response.status}`);
        attempt = 0;
        await readSseFrames(response.body, (data) => {
          const records = parseServersSnapshot(data);
          if (records) replaceServerRegistry(records);
        });
      } catch (error) {
        if (stopped) return;
        // Reconnect with backoff rather than propagate: a transient Control Plane outage must
        // not crash the gateway, and the cache fails safe (untrusted) in the meantime (§5.2).
        process.stdout.write(`${JSON.stringify({ level: "warn", service: "gateway", message: "server-registry stream disconnected", error: String(error) })}\n`);
      }
      if (stopped) return;
      await delay(Math.min(30_000, 1_000 * 2 ** attempt));
      attempt += 1;
    }
  };

  void connect();
  return {
    stop() {
      stopped = true;
      controller.abort();
    }
  };
}

async function readSseFrames(body: ReadableStream<Uint8Array>, onData: (data: string) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf("\n\n");
    while (separator >= 0) {
      const frame = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const dataLines = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice("data:".length).trimStart());
      if (dataLines.length > 0) onData(dataLines.join("\n"));
      separator = buffer.indexOf("\n\n");
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
