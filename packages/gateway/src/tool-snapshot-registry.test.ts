import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearToolSnapshotRegistry,
  getToolSnapshotBaseline,
  parseBaselineResponse,
  replaceToolSnapshotBaseline,
  reportToolObservation,
  startToolSnapshotSync,
} from "./tool-snapshot-registry.js";

const servers: Server[] = [];
const syncs: Array<{ stop(): void }> = [];

afterEach(async () => {
  clearToolSnapshotRegistry();
  syncs.splice(0).forEach((sync) => sync.stop());
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  return `http://127.0.0.1:${address.port}`;
}

describe("tool-snapshot baseline cache", () => {
  it("fails safe to unapproved for a server never synced (§5.1.3)", () => {
    expect(getToolSnapshotBaseline("never-seen")).toEqual({ approved: false, entries: [] });
  });

  it("reflects a replaced baseline", () => {
    replaceToolSnapshotBaseline("file-server", {
      approved: true,
      entries: [{ toolName: "read_file", description: "reads a file", inputSchema: {}, fingerprint: "abc" }],
    });
    expect(getToolSnapshotBaseline("file-server").approved).toBe(true);
    expect(getToolSnapshotBaseline("file-server").entries).toHaveLength(1);
  });
});

describe("parseBaselineResponse", () => {
  it("parses an approved baseline with tools", () => {
    const parsed = parseBaselineResponse(JSON.stringify({
      approved: true,
      tools: [{ toolName: "read_file", description: "reads a file", inputSchema: { type: "object" }, fingerprint: "abc", capturedAt: "2026-01-01T00:00:00Z" }],
    }));
    expect(parsed).toEqual({
      approved: true,
      entries: [{ toolName: "read_file", description: "reads a file", inputSchema: { type: "object" }, fingerprint: "abc" }],
    });
  });

  it("parses an unapproved (no active snapshot) response", () => {
    expect(parseBaselineResponse(JSON.stringify({ approved: false, tools: [] }))).toEqual({ approved: false, entries: [] });
  });

  it("returns undefined for malformed JSON", () => {
    expect(parseBaselineResponse("not json")).toBeUndefined();
  });

  it("returns undefined when the approved flag or tools array is missing", () => {
    expect(parseBaselineResponse(JSON.stringify({ tools: [] }))).toBeUndefined();
    expect(parseBaselineResponse(JSON.stringify({ approved: true }))).toBeUndefined();
  });

  it("drops a malformed tool entry but keeps the rest of the frame", () => {
    const parsed = parseBaselineResponse(JSON.stringify({
      approved: true,
      tools: [
        { toolName: "read_file", description: "reads a file", fingerprint: "abc" },
        { toolName: 5, description: "bad type", fingerprint: "def" },
      ],
    }));
    expect(parsed?.entries).toHaveLength(1);
    expect(parsed?.entries[0]?.toolName).toBe("read_file");
  });
});

describe("startToolSnapshotSync", () => {
  it("populates the cache from a successful fetch", async () => {
    const upstream = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        approved: true,
        tools: [{ toolName: "read_file", description: "reads a file", inputSchema: {}, fingerprint: "abc" }],
      }));
    });
    const baseUrl = await listen(upstream);
    const sync = startToolSnapshotSync(baseUrl, "file-server", 50_000);
    syncs.push(sync);
    await vi.waitFor(() => expect(getToolSnapshotBaseline("file-server").approved).toBe(true));
    expect(getToolSnapshotBaseline("file-server").entries[0]?.toolName).toBe("read_file");
  });

  it("keeps the last good cache on a fetch failure (fail-open, §5.3)", async () => {
    replaceToolSnapshotBaseline("file-server", {
      approved: true,
      entries: [{ toolName: "read_file", description: "reads a file", inputSchema: {}, fingerprint: "abc" }],
    });
    const upstream = createServer((_request, response) => { response.destroy(); });
    const baseUrl = await listen(upstream);
    const sync = startToolSnapshotSync(baseUrl, "file-server", 50_000);
    syncs.push(sync);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getToolSnapshotBaseline("file-server").approved).toBe(true);
    expect(getToolSnapshotBaseline("file-server").entries).toHaveLength(1);
  });

  it("is a no-op when no Control Plane URL is configured", () => {
    const sync = startToolSnapshotSync(undefined, "file-server");
    expect(() => sync.stop()).not.toThrow();
  });
});

describe("reportToolObservation", () => {
  it("posts the observed tools and diffs to the Control Plane", async () => {
    let receivedBody = "";
    let receivedUrl = "";
    const upstream = createServer((request, response) => {
      receivedUrl = request.url ?? "";
      request.on("data", (chunk) => { receivedBody += chunk.toString(); });
      request.on("end", () => response.end("{}"));
    });
    const baseUrl = await listen(upstream);
    reportToolObservation(baseUrl, "file-server", [
      { name: "read_file", description: "reads a file", inputSchema: {}, fingerprint: "abc" },
    ], []);
    await vi.waitFor(() => expect(receivedBody).not.toBe(""));
    expect(receivedUrl).toBe("/api/v1/servers/file-server/tool-observations");
    const parsed = JSON.parse(receivedBody) as { tools: Array<{ name: string }>; diffs: unknown[] };
    expect(parsed.tools[0]?.name).toBe("read_file");
    expect(parsed.diffs).toEqual([]);
  });

  it("does not throw when the Control Plane is unreachable", () => {
    expect(() => reportToolObservation("http://127.0.0.1:1", "file-server", [], [])).not.toThrow();
  });

  it("is a no-op when no Control Plane URL is configured", () => {
    expect(() => reportToolObservation(undefined, "file-server", [], [])).not.toThrow();
  });
});
