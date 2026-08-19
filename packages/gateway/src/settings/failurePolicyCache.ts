// Gateway-side cache of the Control Plane's failure policy (NFR-03, GMCP-68 §4.3).
//
// Mirrors ../server-registry.ts's push-cache shape: a snapshot-replace cache plus a
// self-reconnecting SSE client, so the same operational story (backoff, no polling) applies
// here too. The one deliberate difference is the fail-safe direction: the server registry stays
// fail-*open* on its cache during an outage (keeps the last-known trust grade), but this cache
// starts as `null` (cold) and only a real snapshot from the Control Plane ever sets it — an
// outage that started before the first successful fetch must never let fail-open activate on
// its own (§4.3 REQ-07: "fail-open은 최소 1회 명시적 설정 확인 없이는 절대 활성화되지 않는다").
export type FailurePolicy = "fail_closed" | "fail_open";

let cached: FailurePolicy | null = null;

/** Cold cache (never synced, or Control Plane unreachable since boot) always reads fail_closed. */
export function getFailurePolicy(): FailurePolicy {
  return cached ?? "fail_closed";
}

export function setFailurePolicy(policy: FailurePolicy): void {
  cached = policy;
}

/** Test-only reset back to the cold state; production never needs this. */
export function resetFailurePolicyCache(): void {
  cached = null;
}

// GMCP-84 §9: the same `settings.changed` frame the Control Plane pushes for `failMode` also
// carries `rawPayloadStorageEnabled` (GuardSettingsStore.sendSnapshot), so this reuses the one
// SSE connection above rather than opening a second stream just for this flag. Cold-start default
// is `false` for the same NFR-04/REQ-07 reasoning `getFailurePolicy` uses for fail-closed: an
// opt-in the gateway hasn't heard confirmed by the Control Plane yet must never be assumed on.
let rawPayloadStorageEnabledCache = false;

export function getRawPayloadStorageEnabled(): boolean {
  return rawPayloadStorageEnabledCache;
}

export function setRawPayloadStorageEnabled(enabled: boolean): void {
  rawPayloadStorageEnabledCache = enabled;
}

/** Test-only reset back to the cold state; production never needs this. */
export function resetRawPayloadStorageEnabledCache(): void {
  rawPayloadStorageEnabledCache = false;
}

function isFailurePolicy(value: unknown): value is FailurePolicy {
  return value === "fail_closed" || value === "fail_open";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses one `settings.changed` SSE frame's `{ failMode: "..." }` payload (Control Plane
 * `SettingsController.stream`). Returns `undefined` for a malformed frame so the caller can
 * discard it without touching the cache — never fabricate a policy value from a corrupt frame.
 */
export function parseFailurePolicySnapshot(raw: string): FailurePolicy | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !isFailurePolicy(parsed.failMode)) return undefined;
  return parsed.failMode;
}

/**
 * Parses the same frame's `{ rawPayloadStorageEnabled: boolean }` field (GMCP-84 §9). `undefined`
 * for a frame that doesn't carry this field at all (an older Control Plane, or a malformed
 * frame) so the caller leaves the cache untouched rather than flipping it to `false` on every
 * frame that happens not to mention it.
 */
export function parseRawPayloadStorageEnabledSnapshot(raw: string): boolean | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || typeof parsed.rawPayloadStorageEnabled !== "boolean") return undefined;
  return parsed.rawPayloadStorageEnabled;
}

export interface FailurePolicySync {
  stop(): void;
}

/**
 * Keeps the local cache aligned with the Control Plane's `GuardSettings` (§4.3, REQ-06). Never
 * blocks a verdict on a live round-trip — a failure read always uses the local cache, which this
 * syncs independently in the background with reconnect-on-failure backoff.
 */
export function startFailurePolicySync(baseUrl: string | undefined): FailurePolicySync {
  if (!baseUrl) return { stop() {} };
  const controller = new AbortController();
  let stopped = false;

  const connect = async (): Promise<void> => {
    let attempt = 0;
    while (!stopped) {
      try {
        const response = await fetch(new URL("/api/v1/settings/stream", baseUrl), {
          headers: { accept: "text/event-stream" },
          signal: controller.signal
        });
        if (!response.ok || !response.body) throw new Error(`Settings stream returned ${response.status}`);
        attempt = 0;
        await readSseFrames(response.body, (data) => {
          const policy = parseFailurePolicySnapshot(data);
          if (policy) setFailurePolicy(policy);
          const rawPayloadStorageEnabled = parseRawPayloadStorageEnabledSnapshot(data);
          if (rawPayloadStorageEnabled !== undefined) setRawPayloadStorageEnabled(rawPayloadStorageEnabled);
        });
      } catch (error) {
        if (stopped) return;
        // A disconnected/never-reached Control Plane must not crash the gateway, and must not
        // invent a policy value either — the cache simply keeps whatever it last had (§4.3
        // REQ-07: cold stays cold, a previously-synced value keeps applying until reconnect).
        process.stdout.write(`${JSON.stringify({ level: "warn", service: "gateway", message: "settings stream disconnected", error: String(error) })}\n`);
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
