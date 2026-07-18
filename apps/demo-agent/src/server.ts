import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 3002);
const gatewayUrl = process.env.GATEWAY_URL ?? "http://localhost:3001";

const server = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json; charset=utf-8");
  if (request.url === "/health") {
    const dependencies = await Promise.all([
      check(`${gatewayUrl}/health`),
      check(`${process.env.DEMO_MCP_TOOLS_URL ?? "http://localhost:3003"}/health`)
    ]);
    const up = dependencies.every(Boolean);
    response.statusCode = up ? 200 : 503;
    return response.end(JSON.stringify({ status: up ? "UP" : "DOWN", service: "demo-agent", dependencies }));
  }
  if (request.method === "POST" && request.url === "/demo/pii") {
    try {
      const gatewayResponse = await fetch(`${gatewayUrl}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "demo-pii", method: "tools/call", params: { name: "customer_lookup", arguments: {} } })
      });
      response.statusCode = gatewayResponse.status;
      const body = await gatewayResponse.json() as { result?: unknown; error?: unknown; _guardmcp?: Record<string, unknown> };
      return response.end(JSON.stringify({ ...(body._guardmcp ?? {}), result: body.result, error: body.error }));
    } catch {
      response.statusCode = 503;
      return response.end(JSON.stringify({ code: "GATEWAY_UNAVAILABLE" }));
    }
  }
  response.statusCode = 404;
  return response.end(JSON.stringify({ code: "NOT_FOUND" }));
});

if (process.env.NODE_ENV !== "test") server.listen(port, "0.0.0.0");

export { gatewayUrl, server };

async function check(url: string): Promise<boolean> {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1_500) })).ok; } catch { return false; }
}
