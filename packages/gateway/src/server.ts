import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { connect } from "node:net";
import { evaluate, type Action, type Policy, type PolicyContext } from "@guardmcp/policy-engine";
import { createAutoExpireApprovalBackend } from "./approval/backend.js";
import { detect, mask, type Detection } from "./detect.js";
import { routeByVerdict, type RouterDeps } from "./pipeline/actionRouter.js";
import type { PolicyDecision } from "./pipeline/types.js";
import { runtimePolicyPacks } from "./policies.generated.js";

const port = Number(process.env.PORT ?? 3001);
const maxBodyBytes = 1024 * 1024;

// No approval console is wired up yet (GMCP-82); see ./approval/backend.ts.
const routerDeps: RouterDeps = { approvalBackend: createAutoExpireApprovalBackend() };

class PayloadTooLargeError extends Error {}
class UpstreamError extends Error {
  constructor(message: string, readonly rpcCode: number) { super(message); }
}

export function handler(request: IncomingMessage, response: ServerResponse): void {
  void route(request, response);
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === "GET" && request.url === "/health") {
    const dependencies = await checkTcpDependencies();
    const up = dependencies.every(({ reachable }) => reachable);
    send(response, up ? 200 : 503, { status: up ? "UP" : "DOWN", service: "gateway", dependencies });
    return;
  }
  if (request.method === "POST" && request.url === "/inspect") {
    try {
      const body = await readJson(request);
      const text = typeof body.text === "string" ? body.text : JSON.stringify(body);
      const decision = evaluatePayload(text, { direction: "response", tool: "inspect", serverTrust: "untrusted", args: {} });
      send(response, 200, {
        verdict: decision.verdict,
        riskScore: decision.riskScore,
        policyIds: decision.matchedPolicyIds,
        detections: decision.detections,
        masked: mask(text, decision.detections)
      });
    } catch (error) {
      sendReadError(response, error, false);
    }
    return;
  }
  if (request.method === "POST" && request.url === "/mcp") {
    try {
      const body = await readJson(request);
      await handleMcp(body, response);
    } catch (error) {
      sendReadError(response, error, true);
    }
    return;
  }
  send(response, 404, { code: "NOT_FOUND" });
}

async function handleMcp(body: Record<string, unknown>, response: ServerResponse): Promise<void> {
  const id = body.id ?? null;
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    send(response, 200, rpcError(id, -32600, "Invalid Request"));
    return;
  }
  if (body.method === "initialize") {
    send(response, 200, { jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "guardmcp-kr", version: "0.1.0" } } });
    return;
  }
  const sessionId = sessionIdOf(body);
  if (body.method === "tools/list") {
    const upstream = await upstreamJson("/tools/list");
    const payload = JSON.stringify(upstream);
    const decision = evaluatePayload(payload, { direction: "response", tool: "tools/list", serverTrust: "untrusted", args: {} });
    const routed = await routeByVerdict(
      { direction: "response", toolName: "tools/list", payload, sessionId, serverTrust: "untrusted" },
      decision,
      routerDeps
    );
    if (routed.verdict === "block") {
      send(response, 200, rpcError(id, -32002, "GuardMCP blocked unsafe tool metadata", routed.error.error));
      return;
    }
    send(response, 200, { jsonrpc: "2.0", id, result: JSON.parse(routed.payload), _guardmcp: legacySummary(decision) });
    return;
  }
  if (body.method === "tools/call") {
    const params = isRecord(body.params) ? body.params : {};
    const tool = typeof params.name === "string" ? params.name : "";
    if (!/^[a-zA-Z0-9_-]+$/.test(tool)) {
      send(response, 200, rpcError(id, -32602, "Invalid tool name"));
      return;
    }
    const argumentsValue = params.arguments ?? {};
    const requestPayload = JSON.stringify(argumentsValue);
    const requestDecision = evaluatePayload(requestPayload, {
      direction: "request", tool, serverTrust: "untrusted", args: isRecord(argumentsValue) ? argumentsValue : {}
    });
    const requestRouted = await routeByVerdict(
      { direction: "request", toolName: tool, payload: requestPayload, sessionId, serverTrust: "untrusted" },
      requestDecision,
      routerDeps
    );
    if (requestRouted.verdict === "block") {
      // require_approval auto-expires to block (no console attached, §4.5) but keeps its own RPC code/message.
      const code = requestDecision.verdict === "require_approval" ? -32003 : -32001;
      const message = requestDecision.verdict === "require_approval"
        ? "Human approval required; the demo gateway fails closed"
        : "GuardMCP blocked unsafe tool arguments";
      send(response, 200, rpcError(id, code, message, requestRouted.error.error));
      return;
    }
    const upstream = await upstreamJson(`/tools/call/${encodeURIComponent(tool)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: requestRouted.payload
    });
    const responsePayload = JSON.stringify(upstream);
    const responseDecision = evaluatePayload(responsePayload, { direction: "response", tool, serverTrust: "untrusted", args: {} });
    const responseRouted = await routeByVerdict(
      { direction: "response", toolName: tool, payload: responsePayload, sessionId, serverTrust: "untrusted" },
      responseDecision,
      routerDeps
    );
    if (responseRouted.verdict === "block") {
      send(response, 200, rpcError(id, -32002, "GuardMCP blocked unsafe tool output", responseRouted.error.error));
      return;
    }
    send(response, 200, {
      jsonrpc: "2.0",
      id,
      result: JSON.parse(responseRouted.payload),
      _guardmcp: legacySummary(responseDecision)
    });
    return;
  }
  send(response, 200, rpcError(id, -32601, "Method not found"));
}

async function upstreamJson(path: string, init?: RequestInit): Promise<unknown> {
  const baseUrl = process.env.DEMO_MCP_TOOLS_URL ?? "http://localhost:3003";
  let upstream: Response;
  try {
    upstream = await fetch(new URL(path, baseUrl), { ...init, signal: AbortSignal.timeout(3_000) });
  } catch {
    throw new UpstreamError("Upstream MCP tools are unavailable", -32050);
  }
  if (!upstream.ok) throw new UpstreamError(`Upstream MCP tools returned ${upstream.status}`, -32051);
  const declaredLength = Number(upstream.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) throw new UpstreamError("Upstream MCP response is too large", -32053);
  const reader = upstream.body?.getReader();
  if (!reader) throw new UpstreamError("Upstream MCP response has no body", -32052);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBodyBytes) {
      await reader.cancel();
      throw new UpstreamError("Upstream MCP response is too large", -32053);
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(combined)); }
  catch { throw new UpstreamError("Upstream MCP response is invalid JSON", -32052); }
}

const actionWeight: Record<Action, number> = {
  allow: 0,
  mask_then_allow: 1,
  warn: 2,
  require_approval: 3,
  block: 4
};

/** Runs Detector Core (②-④) + Policy Engine (⑥) and adapts the result into the ⑦ action-router's input contract. */
function evaluatePayload(text: string, context: Pick<PolicyContext, "direction" | "tool" | "serverTrust" | "args">): PolicyDecision {
  const detections = detect(text);
  const riskScore = detections.reduce((score, detection) => Math.max(score, detection.type === "INJECTION" ? 95 : detection.type === "SECRET" ? 85 : 75), 0);
  const activePack = runtimePolicyPacks["korean-pii"];
  if (!activePack) throw new Error("Active policy pack is unavailable");
  const result = evaluate(resolveRuntimePolicies("korean-pii"), {
    ...context,
    detections: detections.map(({ type, subtype }) => ({ type, subtype })),
    riskScore
  }, activePack.defaultAction, activePack.evaluationStrategy);
  return toPolicyDecision(result, detections, riskScore);
}

/**
 * `evaluate()` (GMCP-7) returns matched policies but not which one decided the
 * verdict (that's GMCP-12's `decide()`, not yet on this branch). Recompute
 * the severity-max winner here so the router has a policy to source
 * severity/message/reasonCode/approval config from.
 */
function toPolicyDecision(result: ReturnType<typeof evaluate>, detections: Detection[], riskScore: number): PolicyDecision {
  const deciding = result.policies.reduce<Policy | undefined>(
    (strongest, policy) => (!strongest || actionWeight[policy.action] > actionWeight[strongest.action]) ? policy : strongest,
    undefined
  );
  return {
    verdict: result.action,
    matchedPolicyIds: result.matchedPolicyIds,
    riskScore,
    severity: deciding?.severity ?? "info",
    reasonCode: deciding ? deciding.id.toUpperCase() : "NO_POLICY_MATCH",
    message: deciding?.message ?? "No policy matched; the pack's default action was applied.",
    detections,
    ...(deciding?.approval ? {
      approval: {
        timeoutSeconds: deciding.approval.timeout_seconds,
        onTimeout: deciding.approval.on_timeout,
        allowMaskedApproval: deciding.approval.allow_masked_approval ?? false
      }
    } : {})
  };
}

function legacySummary(decision: PolicyDecision): { verdict: Action; riskScore: number; policyIds: string[] } {
  return { verdict: decision.verdict, riskScore: decision.riskScore, policyIds: decision.matchedPolicyIds };
}

function sessionIdOf(body: Record<string, unknown>): string {
  return typeof body.sessionId === "string" ? body.sessionId : `req-${String(body.id ?? randomUUID())}`;
}

function resolveRuntimePolicies(packName: string, resolving = new Set<string>()): Policy[] {
  if (resolving.has(packName)) throw new Error(`Runtime policy-pack cycle at ${packName}`);
  const pack = runtimePolicyPacks[packName];
  if (!pack) throw new Error(`Unknown runtime policy pack ${packName}`);
  const next = new Set(resolving).add(packName);
  const inherited = pack.extends.flatMap((reference) => resolveRuntimePolicies(reference.split("@")[0] ?? reference, next));
  return [...new Map([...inherited, ...pack.policies].map((policy) => [policy.id, policy])).values()];
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    request.resume();
    throw new PayloadTooLargeError();
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maxBodyBytes) {
      request.resume();
      throw new PayloadTooLargeError();
    }
    chunks.push(buffer);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return isRecord(value) ? value : {};
}

function sendReadError(response: ServerResponse, error: unknown, jsonRpc: boolean): void {
  if (error instanceof PayloadTooLargeError) {
    send(response, 413, jsonRpc ? rpcError(null, -32013, "Payload too large") : { code: "PAYLOAD_TOO_LARGE" });
  } else if (jsonRpc && error instanceof UpstreamError) {
    send(response, 502, rpcError(null, error.rpcCode, error.message));
  } else if (jsonRpc) {
    send(response, 400, rpcError(null, -32700, "Parse error"));
  } else {
    send(response, 400, { code: "INVALID_JSON" });
  }
}

function rpcError(id: unknown, code: number, message: string, data?: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function checkTcpDependencies(): Promise<Array<{ target: string; reachable: boolean }>> {
  const targets = (process.env.DEPENDENCY_TCP ?? "").split(",").map((target) => target.trim()).filter(Boolean);
  return Promise.all(targets.map(async (target) => {
    const separator = target.lastIndexOf(":");
    const host = target.slice(0, separator);
    const targetPort = Number(target.slice(separator + 1));
    if (!host || !Number.isInteger(targetPort)) return { target, reachable: false };
    return { target, reachable: await tcpReachable(host, targetPort) };
  }));
}

function tcpReachable(host: string, targetPort: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port: targetPort });
    const done = (reachable: boolean) => { socket.destroy(); resolve(reachable); };
    socket.setTimeout(750);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
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
