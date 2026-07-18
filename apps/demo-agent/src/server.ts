import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 3002);
const gatewayUrl = process.env.GATEWAY_URL ?? "http://localhost:3001";

const server = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json; charset=utf-8");
  if (request.url === "/health") return response.end(JSON.stringify({ status: "UP", service: "demo-agent" }));
  if (request.method === "POST" && request.url === "/demo/pii") {
    try {
      const gatewayResponse = await fetch(`${gatewayUrl}/inspect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "고객 연락처 010-1234-5678, 계좌 110-123-456789" })
      });
      response.statusCode = gatewayResponse.status;
      return response.end(await gatewayResponse.text());
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
