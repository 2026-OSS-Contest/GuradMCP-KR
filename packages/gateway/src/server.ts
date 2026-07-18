import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { detect, mask } from "./detect.js";

const port = Number(process.env.PORT ?? 3001);

export function handler(request: IncomingMessage, response: ServerResponse): void {
  if (request.method === "GET" && request.url === "/health") {
    send(response, 200, { status: "UP", service: "gateway" });
    return;
  }
  if (request.method === "POST" && request.url === "/inspect") {
    readJson(request).then((body) => {
      const text = typeof body.text === "string" ? body.text : JSON.stringify(body);
      const detections = detect(text);
      send(response, 200, {
        verdict: detections.some(({ type }) => type === "INJECTION" || type === "SECRET") ? "block" : detections.length ? "mask_then_allow" : "allow",
        riskScore: Math.min(100, detections.length * 35),
        policyIds: detections.length ? ["default-detection-policy"] : [],
        detections,
        masked: mask(text, detections)
      });
    }).catch(() => send(response, 400, { code: "INVALID_JSON" }));
    return;
  }
  send(response, 404, { code: "NOT_FOUND" });
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

if (process.env.NODE_ENV !== "test") {
  createServer(handler).listen(port, "0.0.0.0", () => {
    process.stdout.write(`${JSON.stringify({ level: "info", service: "gateway", port, message: "listening" })}\n`);
  });
}
