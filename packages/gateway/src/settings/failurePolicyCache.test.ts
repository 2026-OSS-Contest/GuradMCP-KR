import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getFailurePolicy,
  getRawPayloadStorageEnabled,
  parseFailurePolicySnapshot,
  parseRawPayloadStorageEnabledSnapshot,
  resetFailurePolicyCache,
  resetRawPayloadStorageEnabledCache,
  setFailurePolicy,
  setRawPayloadStorageEnabled,
  startFailurePolicySync
} from "./failurePolicyCache.js";

const servers: Server[] = [];
const syncs: Array<{ stop(): void }> = [];

afterEach(async () => {
  resetFailurePolicyCache();
  resetRawPayloadStorageEnabledCache();
  syncs.splice(0).forEach((sync) => sync.stop());
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("failure-policy cache", () => {
  it("fails closed when the cache has never been synced (REQ-07)", () => {
    expect(getFailurePolicy()).toBe("fail_closed");
  });

  it("reflects a value that was set", () => {
    setFailurePolicy("fail_open");
    expect(getFailurePolicy()).toBe("fail_open");
  });

  it("returns to fail_closed after a reset (cold-start simulation)", () => {
    setFailurePolicy("fail_open");
    resetFailurePolicyCache();
    expect(getFailurePolicy()).toBe("fail_closed");
  });
});

describe("parseFailurePolicySnapshot", () => {
  it("parses a valid { failMode } payload", () => {
    expect(parseFailurePolicySnapshot(JSON.stringify({ failMode: "fail_open" }))).toBe("fail_open");
  });

  it("returns undefined for an unrecognized failMode value", () => {
    expect(parseFailurePolicySnapshot(JSON.stringify({ failMode: "yolo" }))).toBeUndefined();
  });

  it("returns undefined for malformed JSON", () => {
    expect(parseFailurePolicySnapshot("not json")).toBeUndefined();
  });

  it("returns undefined when failMode is missing", () => {
    expect(parseFailurePolicySnapshot(JSON.stringify({}))).toBeUndefined();
  });
});

describe("raw-payload-storage cache (GMCP-84 §9)", () => {
  it("fails closed (off) when the cache has never been synced", () => {
    expect(getRawPayloadStorageEnabled()).toBe(false);
  });

  it("reflects a value that was set", () => {
    setRawPayloadStorageEnabled(true);
    expect(getRawPayloadStorageEnabled()).toBe(true);
  });

  it("returns to false after a reset (cold-start simulation)", () => {
    setRawPayloadStorageEnabled(true);
    resetRawPayloadStorageEnabledCache();
    expect(getRawPayloadStorageEnabled()).toBe(false);
  });
});

describe("parseRawPayloadStorageEnabledSnapshot", () => {
  it("parses a valid { rawPayloadStorageEnabled } payload", () => {
    expect(parseRawPayloadStorageEnabledSnapshot(JSON.stringify({ rawPayloadStorageEnabled: true }))).toBe(true);
    expect(parseRawPayloadStorageEnabledSnapshot(JSON.stringify({ rawPayloadStorageEnabled: false }))).toBe(false);
  });

  it("returns undefined when the field is missing, so the cache is left untouched", () => {
    expect(parseRawPayloadStorageEnabledSnapshot(JSON.stringify({ failMode: "fail_open" }))).toBeUndefined();
  });

  it("returns undefined for malformed JSON", () => {
    expect(parseRawPayloadStorageEnabledSnapshot("not json")).toBeUndefined();
  });
});

describe("startFailurePolicySync", () => {
  it("is a no-op when no Control Plane URL is configured", () => {
    const sync = startFailurePolicySync(undefined);
    expect(() => sync.stop()).not.toThrow();
  });

  it("applies the initial snapshot on connect and a later push without polling", async () => {
    // The initial frame is fail_open — distinct from the cold-cache default of fail_closed —
    // so a passing first assertion actually proves the SSE frame was applied, not just that the
    // cache started at its default value.
    let sendUpdate: (() => void) | undefined;
    const upstream = createServer((request, response) => {
      if (request.url !== "/api/v1/settings/stream") { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`event: settings.changed\ndata: ${JSON.stringify({ failMode: "fail_open" })}\n\n`);
      sendUpdate = () => response.write(`event: settings.changed\ndata: ${JSON.stringify({ failMode: "fail_closed" })}\n\n`);
    });
    const baseUrl = await listen(upstream);

    const sync = startFailurePolicySync(baseUrl);
    syncs.push(sync);

    await vi.waitFor(() => expect(getFailurePolicy()).toBe("fail_open"));

    sendUpdate?.();
    await vi.waitFor(() => expect(getFailurePolicy()).toBe("fail_closed"));
  });

  it("also syncs rawPayloadStorageEnabled off the same frame (GMCP-84 §9)", async () => {
    let sendUpdate: (() => void) | undefined;
    const upstream = createServer((request, response) => {
      if (request.url !== "/api/v1/settings/stream") { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`event: settings.changed\ndata: ${JSON.stringify({ failMode: "fail_closed", rawPayloadStorageEnabled: true })}\n\n`);
      sendUpdate = () => response.write(`event: settings.changed\ndata: ${JSON.stringify({ failMode: "fail_closed", rawPayloadStorageEnabled: false })}\n\n`);
    });
    const baseUrl = await listen(upstream);

    const sync = startFailurePolicySync(baseUrl);
    syncs.push(sync);

    await vi.waitFor(() => expect(getRawPayloadStorageEnabled()).toBe(true));

    sendUpdate?.();
    await vi.waitFor(() => expect(getRawPayloadStorageEnabled()).toBe(false));
  });

  it("discards a malformed frame instead of reverting to fail_closed", async () => {
    let sendMalformed: (() => void) | undefined;
    const upstream = createServer((request, response) => {
      if (request.url !== "/api/v1/settings/stream") { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`event: settings.changed\ndata: ${JSON.stringify({ failMode: "fail_open" })}\n\n`);
      sendMalformed = () => response.write(`event: settings.changed\ndata: not valid json\n\n`);
    });
    const baseUrl = await listen(upstream);

    const sync = startFailurePolicySync(baseUrl);
    syncs.push(sync);
    await vi.waitFor(() => expect(getFailurePolicy()).toBe("fail_open"));

    sendMalformed?.();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getFailurePolicy()).toBe("fail_open");
  });
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  return `http://127.0.0.1:${address.port}`;
}
