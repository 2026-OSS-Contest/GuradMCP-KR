import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dbTools } from "./tools/db.js";
import { emailTools } from "./tools/email.js";
import { fileTools } from "./tools/file.js";
import { webTools } from "./tools/web.js";
import { ToolError, type ToolDefinition, type ToolDescriptor } from "./types.js";

const port = Number(process.env.PORT ?? 3003);
const maxBodyBytes = 256 * 1024;

class PayloadTooLargeError extends Error {}

export const tools: ToolDefinition[] = [...fileTools, ...dbTools, ...webTools, ...emailTools];
const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

export function handler(request: IncomingMessage, response: ServerResponse): void {
  void route(request, response);
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = request.url ?? "";
  if (request.method === "GET" && (url === "/health" || url === "/healthz")) {
    send(response, 200, { status: "UP", service: "demo-mcp-tools" });
    return;
  }
  if (request.method === "GET" && url === "/tools/list") {
    send(response, 200, { tools: descriptors() });
    return;
  }
  if (request.method === "POST" && url.startsWith("/tools/call/")) {
    const name = decodeURIComponent(url.slice("/tools/call/".length));
    const tool = toolsByName.get(name);
    if (!tool) {
      send(response, 404, { code: "TOOL_NOT_FOUND", message: `Unknown tool: ${name}` });
      return;
    }
    try {
      const args = await readJsonBody(request);
      const result = await tool.handler(args);
      send(response, 200, result);
    } catch (error) {
      sendToolError(response, error);
    }
    return;
  }
  send(response, 404, { code: "NOT_FOUND" });
}

function descriptors(): ToolDescriptor[] {
  return tools.map(({ handler: _handler, ...descriptor }) => descriptor);
}

function sendToolError(response: ServerResponse, error: unknown): void {
  if (error instanceof ToolError) {
    send(response, error.status, { code: "TOOL_ERROR", message: error.message });
  } else if (error instanceof PayloadTooLargeError) {
    send(response, 413, { code: "PAYLOAD_TOO_LARGE" });
  } else if (error instanceof SyntaxError) {
    send(response, 400, { code: "INVALID_JSON" });
  } else {
    send(response, 500, { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Unknown error" });
  }
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    request.resume();
    throw new PayloadTooLargeError();
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array);
    bytes += buffer.byteLength;
    if (bytes > maxBodyBytes) {
      request.resume();
      throw new PayloadTooLargeError();
    }
    chunks.push(buffer);
  }
  if (bytes === 0) return {};
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

if (process.env.NODE_ENV !== "test") {
  createServer(handler).listen(port, "0.0.0.0", () => {
    process.stdout.write(`${JSON.stringify({ level: "info", service: "demo-mcp-tools", port, message: "listening" })}\n`);
  });
}
