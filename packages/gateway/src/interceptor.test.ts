import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetMetrics } from "./pipeline/metrics.js";
import { handler } from "./server.js";

/**
 * GMCP-52 acceptance criteria, exercised through the real HTTP handler rather than
 * the pipeline in isolation: the interceptor must carry its own latency measurement
 * (NFR-01) and stay stable under concurrent sessions (NFR-02).
 */
const servers: Server[] = [];

beforeEach(resetMetrics);

afterEach(async () => {
  delete process.env.DEMO_MCP_TOOLS_URL;
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("tool-call interceptor instrumentation (GMCP-52)", () => {
  it("exposes verdict counts and pipeline latency after inspecting a payload", async () => {
    const url = await listen(createServer(handler));
    await inspect(url, "연락처 010-1234-5678");

    const snapshot = await metrics(url);
    expect(snapshot.inspections).toBeGreaterThanOrEqual(1);
    expect(Object.values(snapshot.verdicts).reduce((sum, count) => sum + count, 0)).toBe(snapshot.inspections);
    expect(snapshot.latency.count).toBeGreaterThanOrEqual(1);
    expect(snapshot.latency.p95Ms).toBeGreaterThanOrEqual(0);
  });

  it("never reports payload text or detected values in metrics (NFR-04)", async () => {
    const url = await listen(createServer(handler));
    await inspect(url, "주민번호 900101-1234568, 연락처 010-1234-5678");

    const raw = JSON.stringify(await metrics(url));
    expect(raw).not.toContain("900101-1234568");
    expect(raw).not.toContain("010-1234-5678");
    expect(raw).not.toContain("RRN_LIKE");
  });

  it("keeps the rule pipeline inside the p95 budget for a 10KB payload (NFR-01)", async () => {
    const url = await listen(createServer(handler));
    const payload = `${"a".repeat(10 * 1024 - 14)} 010-1234-5678`;
    for (let run = 0; run < 40; run += 1) await inspect(url, payload);

    const snapshot = await metrics(url);
    expect(snapshot.latency.count).toBe(40);
    expect(snapshot.latency.p95Ms).toBeLessThan(50);
  });

  it("stays stable and loses no inspection across 100 concurrent sessions (NFR-02)", async () => {
    const url = await listen(createServer(handler));
    const sessions = Array.from({ length: 100 }, (_unused, index) => inspect(url, `세션 ${index} 연락처 010-1234-5678`));

    const statuses = await Promise.all(sessions);
    expect(statuses.every((status) => status === 200)).toBe(true);

    const snapshot = await metrics(url);
    // Every concurrent session is accounted for exactly once: no dropped or double counts.
    expect(snapshot.inspections).toBe(100);
    expect(Object.values(snapshot.verdicts).reduce((sum, count) => sum + count, 0)).toBe(100);
  });
});

async function inspect(baseUrl: string, text: string): Promise<number> {
  const response = await fetch(`${baseUrl}/inspect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text })
  });
  await response.arrayBuffer();
  return response.status;
}

async function metrics(baseUrl: string): Promise<{
  inspections: number;
  verdicts: Record<string, number>;
  latency: { count: number; p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number };
}> {
  const response = await fetch(`${baseUrl}/metrics`);
  expect(response.status).toBe(200);
  return await response.json() as Awaited<ReturnType<typeof metrics>>;
}

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  return `http://127.0.0.1:${address.port}`;
}
