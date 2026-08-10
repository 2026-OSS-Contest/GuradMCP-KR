import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearServerRegistry,
  getServerTrust,
  parseServersSnapshot,
  replaceServerRegistry,
  startServerRegistrySync
} from "./server-registry.js";

const servers: Server[] = [];
const syncs: Array<{ stop(): void }> = [];

afterEach(async () => {
  clearServerRegistry();
  syncs.splice(0).forEach((sync) => sync.stop());
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("server-registry cache", () => {
  it("fails safe to untrusted for a server that was never synced (§4.1, NFR-03)", () => {
    expect(getServerTrust("never-seen")).toBe("untrusted");
  });

  it("reflects a replaced snapshot", () => {
    replaceServerRegistry([{ id: "file-server", trustLevel: "limited" }, { id: "mail-server", trustLevel: "trusted" }]);
    expect(getServerTrust("file-server")).toBe("limited");
    expect(getServerTrust("mail-server")).toBe("trusted");
  });

  it("drops a server that a later snapshot no longer lists, back to untrusted", () => {
    replaceServerRegistry([{ id: "file-server", trustLevel: "trusted" }]);
    replaceServerRegistry([{ id: "mail-server", trustLevel: "trusted" }]);
    expect(getServerTrust("file-server")).toBe("untrusted");
  });
});

describe("parseServersSnapshot", () => {
  it("parses a valid { servers: [...] } payload", () => {
    const records = parseServersSnapshot(JSON.stringify({ servers: [{ id: "a", name: "a", connected: true, trust: "limited" }] }));
    expect(records).toEqual([{ id: "a", trustLevel: "limited" }]);
  });

  it("silently drops individual entries with an invalid trust value, keeping the frame", () => {
    const records = parseServersSnapshot(JSON.stringify({ servers: [{ id: "a", trust: "super-trusted" }] }));
    expect(records).toEqual([]);
  });

  it("accepts a genuinely empty registry as [], distinct from a malformed frame", () => {
    expect(parseServersSnapshot(JSON.stringify({ servers: [] }))).toEqual([]);
  });

  it("returns undefined (not []) for malformed JSON, so a corrupt frame never wipes the cache", () => {
    expect(parseServersSnapshot("not json")).toBeUndefined();
  });

  it("returns undefined when the servers field is missing", () => {
    expect(parseServersSnapshot(JSON.stringify({}))).toBeUndefined();
  });
});

describe("startServerRegistrySync", () => {
  it("is a no-op when no Control Plane URL is configured", () => {
    const sync = startServerRegistrySync(undefined);
    expect(() => sync.stop()).not.toThrow();
  });

  it("applies the initial snapshot on connect and a later push without polling", async () => {
    let sendUpdate: (() => void) | undefined;
    const upstream = createServer((request, response) => {
      if (request.url !== "/api/v1/servers/stream") { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`event: servers.snapshot\ndata: ${JSON.stringify({ servers: [{ id: "file-server", name: "file-server", connected: true, trust: "limited" }] })}\n\n`);
      sendUpdate = () => response.write(`event: servers.snapshot\ndata: ${JSON.stringify({ servers: [{ id: "file-server", name: "file-server", connected: true, trust: "untrusted" }] })}\n\n`);
    });
    const baseUrl = await listen(upstream);

    const sync = startServerRegistrySync(baseUrl);
    syncs.push(sync);

    await vi.waitFor(() => expect(getServerTrust("file-server")).toBe("limited"));

    sendUpdate?.();
    await vi.waitFor(() => expect(getServerTrust("file-server")).toBe("untrusted"));
  });

  it("discards a malformed frame instead of wiping the cache back to untrusted", async () => {
    let sendMalformed: (() => void) | undefined;
    const upstream = createServer((request, response) => {
      if (request.url !== "/api/v1/servers/stream") { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`event: servers.snapshot\ndata: ${JSON.stringify({ servers: [{ id: "file-server", name: "file-server", connected: true, trust: "limited" }] })}\n\n`);
      sendMalformed = () => response.write(`event: servers.snapshot\ndata: not valid json\n\n`);
    });
    const baseUrl = await listen(upstream);

    const sync = startServerRegistrySync(baseUrl);
    syncs.push(sync);
    await vi.waitFor(() => expect(getServerTrust("file-server")).toBe("limited"));

    sendMalformed?.();
    // Give the malformed frame a tick to (not) take effect, then confirm the cache still holds
    // the last good snapshot rather than having been cleared to the untrusted fail-safe.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getServerTrust("file-server")).toBe("limited");
  });
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  return `http://127.0.0.1:${address.port}`;
}
