// The one behaviour in `sse.ts` that is not observable from a screen: what it does with a URL
// nothing serves. That became reachable in fix-api.md §2, when the four call sites dropped their
// `MOCK_API ? "/api/v1/events/stream" : null` guard so the `CONTROL_PLANE_URL` rewrite could be
// used when it is configured. `EventSource` reports "404 with an HTML body" and "connection
// refused" identically, so a build with no event source behind it looks exactly like a backend
// that is briefly down — and the difference has to be drawn from whether it has *ever* answered.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSseClient, type SseStatus } from "./sse";

/** Just enough of the `EventSource` surface for `sse.ts`: it opens, errors, and closes. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  listeners = new Map<string, (event: MessageEvent) => void>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: MessageEvent) => void) {
    this.listeners.set(type, handler);
  }

  close() {
    this.closed = true;
  }
}

/** A URL of its own per test: `sse.ts` shares one connection per URL across the whole module. */
let counter = 0;
const freshUrl = () => `/api/v1/events/stream?case=${(counter += 1)}`;

/** Run every scheduled reconnect to exhaustion — the backoff caps at 30s, so this terminates. */
const drainRetries = async () => {
  for (let i = 0; i < 20; i += 1) await vi.advanceTimersByTimeAsync(60_000);
};

describe("createSseClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stops reaching for a URL that has never answered, instead of retrying for the life of the tab", async () => {
    const statuses: SseStatus[] = [];
    createSseClient({ url: freshUrl(), onMessage: () => {}, onStatusChange: (s) => statuses.push(s) });

    // Every attempt fails the way a 404 does: `EventSource` fires `onerror` and never `onopen`.
    for (let i = 0; i < 20; i += 1) {
      FakeEventSource.instances.at(-1)?.onerror?.();
      await vi.advanceTimersByTimeAsync(60_000);
    }

    expect(FakeEventSource.instances).toHaveLength(5);
    expect(statuses.at(-1)).toBe("closed");
  });

  it("keeps reconnecting a stream that has answered once, however long it stays down", async () => {
    const statuses: SseStatus[] = [];
    createSseClient({ url: freshUrl(), onMessage: () => {}, onStatusChange: (s) => statuses.push(s) });

    // One successful open is the whole difference: this is a live console losing its backend,
    // not a build that never had one.
    FakeEventSource.instances[0].onopen?.();
    expect(statuses).toContain("open");

    for (let i = 0; i < 20; i += 1) {
      FakeEventSource.instances.at(-1)?.onerror?.();
      await vi.advanceTimersByTimeAsync(60_000);
    }

    expect(FakeEventSource.instances.length).toBeGreaterThan(5);
    expect(statuses.at(-1)).toBe("reconnecting");
  });

  it("counts attempts from the last success, so a flaky stream never accumulates its way to closed", async () => {
    const statuses: SseStatus[] = [];
    createSseClient({ url: freshUrl(), onMessage: () => {}, onStatusChange: (s) => statuses.push(s) });

    for (let cycle = 0; cycle < 4; cycle += 1) {
      // Four failures — one short of the cold limit — then an open that resets the count.
      for (let i = 0; i < 4; i += 1) {
        FakeEventSource.instances.at(-1)?.onerror?.();
        await vi.advanceTimersByTimeAsync(60_000);
      }
      FakeEventSource.instances.at(-1)?.onopen?.();
    }

    expect(statuses.at(-1)).toBe("open");
    expect(statuses).not.toContain("closed");
  });

  it("lets a remount try again after a give-up, and does not let the abandoned client close it", async () => {
    const url = freshUrl();
    const first = createSseClient({ url, onMessage: () => {} });
    for (let i = 0; i < 5; i += 1) {
      FakeEventSource.instances.at(-1)?.onerror?.();
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(FakeEventSource.instances).toHaveLength(5);

    // The screen remounts and asks again — a fresh connection, not the abandoned one.
    const statuses: SseStatus[] = [];
    createSseClient({ url, onMessage: () => {}, onStatusChange: (s) => statuses.push(s) });
    expect(FakeEventSource.instances).toHaveLength(6);
    const live = FakeEventSource.instances[5];
    live.onopen?.();
    expect(statuses.at(-1)).toBe("open");

    // The give-up dropped the first client's connection from the shared map, so its late
    // `close()` must not reach the replacement now registered under the same URL.
    first.close();
    expect(live.closed).toBe(false);
  });

  it("shares one connection per URL, and tears it down only when the last subscriber leaves", async () => {
    const url = freshUrl();
    const a = createSseClient({ url, onMessage: () => {} });
    const b = createSseClient({ url, onMessage: () => {} });
    expect(FakeEventSource.instances).toHaveLength(1);

    const source = FakeEventSource.instances[0];
    source.onopen?.();

    a.close();
    expect(source.closed).toBe(false);
    b.close();
    expect(source.closed).toBe(true);

    await drainRetries();
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
