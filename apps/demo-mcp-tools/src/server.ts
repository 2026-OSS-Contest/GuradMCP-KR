import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 3003);
const demoCustomers = [
  { id: "C-001", name: "김가드", phone: "010-1234-5678", account: "110-123-456789" }
];

const server = createServer((request, response) => {
  response.setHeader("content-type", "application/json; charset=utf-8");
  if (request.url === "/health") return response.end(JSON.stringify({ status: "UP", service: "demo-mcp-tools" }));
  if (request.url === "/tools/list") return response.end(JSON.stringify({ tools: [{ name: "customer_lookup", risk: "limited" }] }));
  if (request.url === "/tools/call/customer_lookup") return response.end(JSON.stringify({ content: demoCustomers }));
  response.statusCode = 404;
  return response.end(JSON.stringify({ code: "NOT_FOUND" }));
});

if (process.env.NODE_ENV !== "test") server.listen(port, "0.0.0.0");

export { demoCustomers, server };
