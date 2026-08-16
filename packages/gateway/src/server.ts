import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { connect } from "node:net";
import {
  evaluate,
  extractPathArg,
  normalizePath,
  type Action,
  type Policy,
  type PolicyContext,
} from "@guardmcp/policy-engine";
import { createAutoExpireApprovalBackend } from "./approval/backend.js";
import { createControlPlaneApprovalBackend } from "./controlPlane/approvalBackend.js";
import { detect, mask, type Detection } from "./detect.js";
import {
  digest,
  routeByVerdict,
  toEventDetection,
  type RouterDeps,
} from "./pipeline/actionRouter.js";
import { emitGuardEvent } from "./pipeline/events.js";
import { explainDecision } from "./pipeline/explanation.js";
// Side-effect import: registers the pipeline-⑧ Event Emitter's guardEventBus subscription.
import { auditPublisherMetrics } from "./pipeline/auditPublisher.js";
import { handlePipelineFailure } from "./pipeline/failsafe.js";
import { metricsSnapshot, recordInspection } from "./pipeline/metrics.js";
import {
  createStageBudgetTracker,
  PipelineStageError,
  runStage,
} from "./pipeline/pipelineRunner.js";
import {
  inspectToolMetadata,
  type QuarantinedToolReport,
  type ToolMetadataInspection,
} from "./pipeline/toolMetadata.js";
import type {
  GuardBlockError,
  PolicyDecision,
  ServerTrust,
} from "./pipeline/types.js";
import { scoreRisk } from "./risk.js";
import { getServerTrust, startServerRegistrySync } from "./server-registry.js";
import { startFailurePolicySync } from "./settings/failurePolicyCache.js";
import { runtimePolicyPacks } from "./policies.generated.js";

const port = Number(process.env.PORT ?? 3001);
const maxBodyBytes = 1024 * 1024;

// send_email's subject and body are joined with this before inspection/masking (see
// `tools/call` handling below) so detect()/the policy engine see one text and one risk
// score for the whole message. Reconstructing subject/body afterward (`resolveEmailFields`)
// never searches the joined text for this separator — a masked span can consume it, and a
// multi-line subject would spoof it — so its exact value only matters as an offset (its
// `.length`) into the joined text, not as content anyone parses back out.
const EMAIL_FIELD_SEPARATOR = "\n";

// The demo gateway routes to a single upstream (DEMO_MCP_TOOLS_URL); this is that upstream's
// identity in the Control Plane's server registry (FR-GW-02 §3.1, §4.1).
const gatewayServerId = process.env.GATEWAY_SERVER_ID ?? "demo-mcp-tools";
startServerRegistrySync(process.env.CONTROL_PLANE_URL);
// NFR-03/GMCP-68 §4.3: cache starts cold (fail-closed) until the first snapshot arrives.
startFailurePolicySync(process.env.CONTROL_PLANE_URL);

// With CONTROL_PLANE_URL set, a real Approval Console can resolve `require_approval` calls
// (§5.1, GMCP-26); otherwise there is nothing to answer them, so fail-closed immediately
// (see ./approval/backend.ts) rather than holding every such call open for its full timeout.
const routerDeps: RouterDeps = {
  approvalBackend: process.env.CONTROL_PLANE_URL
    ? createControlPlaneApprovalBackend(process.env.CONTROL_PLANE_URL)
    : createAutoExpireApprovalBackend(),
};

class PayloadTooLargeError extends Error {}
class UpstreamError extends Error {
  constructor(
    message: string,
    readonly rpcCode: number,
  ) {
    super(message);
  }
}

export function handler(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  void route(request, response);
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === "GET" && request.url === "/health") {
    const dependencies = await checkTcpDependencies();
    const up = dependencies.every(({ reachable }) => reachable);
    send(response, up ? 200 : 503, {
      status: up ? "UP" : "DOWN",
      service: "gateway",
      dependencies,
    });
    return;
  }
  if (request.method === "GET" && request.url === "/metrics") {
    // Verdict counts and pipeline latency only (NFR-06). Never payloads or detected
    // values — this endpoint must not become a second way to read protected data.
    // `audit` is the Event Emitter's own health (NFR-06: publish success rate, queue backlog).
    send(response, 200, {
      service: "gateway",
      ...metricsSnapshot(),
      audit: auditPublisherMetrics(),
    });
    return;
  }
  if (request.method === "POST" && request.url === "/inspect") {
    try {
      const body = await readJson(request);
      const text =
        typeof body.text === "string" ? body.text : JSON.stringify(body);
      const decision = evaluatePayload(text, {
        direction: "response",
        tool: "inspect",
        serverTrust: getServerTrust(gatewayServerId),
        args: {},
      });
      send(response, 200, {
        verdict: decision.verdict,
        riskScore: decision.riskScore,
        policyIds: decision.matchedPolicyIds,
        detections: decision.detections,
        masked: mask(text, decision.detections),
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

async function handleMcp(
  body: Record<string, unknown>,
  response: ServerResponse,
): Promise<void> {
  const id = body.id ?? null;
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    send(response, 200, rpcError(id, -32600, "Invalid Request"));
    return;
  }
  if (body.method === "initialize") {
    send(response, 200, {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "guardmcp-kr", version: "0.1.0" },
      },
    });
    return;
  }
  const sessionId = sessionIdOf(body);
  const serverTrust = getServerTrust(gatewayServerId);
  if (body.method === "tools/list") {
    const upstream = await upstreamJson("/tools/list");
    // Quarantine poisoned descriptors first (FR-GW-04): a tool description is guidance
    // the Agent acts on, so the injection must be removed before anything downstream —
    // including this gateway's own reply — can carry it.
    const metadata = inspectToolMetadata(upstream);
    if (!metadata.recognized) {
      // Per-tool quarantine did nothing here. Say so, rather than letting an unfamiliar
      // upstream shape look like a clean inspection.
      logEvent(
        "warn",
        "tools/list carried no recognizable tool list; per-tool quarantine was skipped",
      );
    }
    const quarantineDecisions = recordQuarantine(
      metadata,
      sessionId,
      gatewayServerId,
      serverTrust,
    );
    const payload = JSON.stringify(metadata.sanitized);
    const decision = evaluatePayload(payload, {
      direction: "response",
      tool: "tools/list",
      serverTrust,
      args: {},
    });
    const summary = summarizeWithQuarantine(
      decision,
      quarantineDecisions,
      metadata,
    );
    const routed = await routeByVerdict(
      {
        direction: "response",
        toolName: "tools/list",
        payload,
        sessionId,
        serverId: gatewayServerId,
        serverTrust,
      },
      decision,
      routerDeps,
    );
    if (routed.verdict === "block") {
      // Keep the quarantine visible even when the sanitized payload blocks for its own
      // reasons; otherwise the Agent loses the record of which tools were removed.
      send(response, 200, {
        jsonrpc: "2.0",
        id,
        error: {
          ...routed.error,
          data: {
            ...routed.error.data,
            quarantinedTools: summary.quarantinedTools,
          },
        },
      });
      return;
    }
    send(response, 200, {
      jsonrpc: "2.0",
      id,
      result: JSON.parse(routed.payload),
      _guardmcp: summary,
    });
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
    // `to` is itself detected as PII.EMAIL (§5.1 GMCP-26): inspecting/masking the whole args
    // JSON would corrupt the recipient address on a masked approval, so `to` is excluded from
    // the inspected text and passes through untouched either way. `subject` is not excluded —
    // a secret or PII value placed in `subject` instead of `body` is exactly as real, and a
    // detector that only ever looked at `body` let it through unmasked and unscored. So
    // `subject` and `body` are joined into one inspected text and split back apart afterward.
    const emailBody =
      tool === "send_email" &&
      isRecord(argumentsValue) &&
      typeof argumentsValue.body === "string"
        ? argumentsValue.body
        : undefined;
    const emailSubject =
      tool === "send_email" &&
      isRecord(argumentsValue) &&
      typeof argumentsValue.subject === "string"
        ? argumentsValue.subject
        : undefined;
    const requestPayload =
      emailBody !== undefined
        ? `${emailSubject ?? ""}${EMAIL_FIELD_SEPARATOR}${emailBody}`
        : JSON.stringify(argumentsValue);
    // The Approval Card's `arguments` (NFR-04) is an allowlist, not an exclude filter: only
    // `to`/`subject` — plain strings the card needs for its summary — are ever forwarded to
    // Control Plane. `body` is withheld on purpose (it's exactly the text `maskPreview` already
    // carries and whose raw form Control Plane clears on `decide()`/`sweepExpired()`; sending it
    // again as a plain arg would leave a copy nothing ever clears). Any other argument (cc,
    // reply_to, attachments, ...) is dropped rather than passed through, both because the card
    // has no use for it and because a non-string value would fail to bind against Control
    // Plane's `Map<String, String>` and take the whole approval down with it — `submit()` would
    // see a non-2xx response and fail closed to an unreachable id, so the Agent would see
    // APPROVAL_TIMEOUT_BLOCKED even with Control Plane fully up. Every other tool gets no
    // `arguments` at all, since there is no such split to fall back on for an arbitrary payload.
    const cardArguments =
      emailBody !== undefined && isRecord(argumentsValue)
        ? Object.fromEntries(
            (["to", "subject"] as const)
              .filter((key) => typeof argumentsValue[key] === "string")
              .map((key) => [key, argumentsValue[key] as string]),
          )
        : undefined;
    const requestDecision = evaluatePayload(requestPayload, {
      direction: "request",
      tool,
      serverTrust,
      args: isRecord(argumentsValue) ? argumentsValue : {},
    });
    const requestRouted = await routeByVerdict(
      {
        direction: "request",
        toolName: tool,
        payload: requestPayload,
        arguments: cardArguments,
        sessionId,
        serverId: gatewayServerId,
        serverTrust,
      },
      requestDecision,
      routerDeps,
    );
    if (requestRouted.verdict === "block") {
      // require_approval auto-expires to block (no console attached, §4.5); the standardized
      // error (FR-GW-05 §3.1) uses one fixed code/message regardless of cause — reasonCode
      // (APPROVAL_TIMEOUT_BLOCKED vs. the deciding policy's own code) carries the distinction.
      send(response, 200, rpcBlockError(id, requestRouted.error));
      return;
    }
    // Reconstruct subject/body onto the untouched `to` rather than sending
    // `requestRouted.payload` verbatim, which for send_email is the joined subject+body text —
    // see `resolveEmailFields` for why this is offset arithmetic against the *originals*, not a
    // re-parse of the (possibly masked) joined text.
    const upstreamRequestBody =
      emailBody !== undefined
        ? JSON.stringify({
            ...argumentsValue,
            ...resolveEmailFields(
              requestRouted.verdict,
              emailSubject,
              emailBody,
              requestDecision.detections,
            ),
          })
        : requestRouted.payload;
    const upstream = await upstreamJson(
      `/tools/call/${encodeURIComponent(tool)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: upstreamRequestBody,
      },
    );
    const responsePayload = JSON.stringify(upstream);
    const responseDecision = evaluatePayload(responsePayload, {
      direction: "response",
      tool,
      serverTrust,
      args: {},
    });
    const responseRouted = await routeByVerdict(
      {
        direction: "response",
        toolName: tool,
        payload: responsePayload,
        sessionId,
        serverId: gatewayServerId,
        serverTrust,
      },
      responseDecision,
      routerDeps,
    );
    if (responseRouted.verdict === "block") {
      send(response, 200, rpcBlockError(id, responseRouted.error));
      return;
    }
    send(response, 200, {
      jsonrpc: "2.0",
      id,
      result: JSON.parse(responseRouted.payload),
      _guardmcp: legacySummary(responseDecision),
    });
    return;
  }
  send(response, 200, rpcError(id, -32601, "Method not found"));
}

async function upstreamJson(
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const baseUrl = process.env.DEMO_MCP_TOOLS_URL ?? "http://localhost:3003";
  let upstream: Response;
  try {
    upstream = await fetch(new URL(path, baseUrl), {
      ...init,
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    throw new UpstreamError("Upstream MCP tools are unavailable", -32050);
  }
  if (!upstream.ok)
    throw new UpstreamError(
      `Upstream MCP tools returned ${upstream.status}`,
      -32051,
    );
  const declaredLength = Number(upstream.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes)
    throw new UpstreamError("Upstream MCP response is too large", -32053);
  const reader = upstream.body?.getReader();
  if (!reader)
    throw new UpstreamError("Upstream MCP response has no body", -32052);
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
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(combined));
  } catch {
    throw new UpstreamError("Upstream MCP response is invalid JSON", -32052);
  }
}

const actionWeight: Record<Action, number> = {
  allow: 0,
  mask_then_allow: 1,
  warn: 2,
  require_approval: 3,
  block: 4,
};

/**
 * Runs Detector Core (②-④) + Policy Engine (⑥) and adapts the result into the ⑦
 * action-router's input contract.
 *
 * Every inspection funnels through here, so this is where the rule pipeline is timed
 * (GMCP-52, NFR-01): the measurement covers detection, risk scoring, and policy
 * evaluation on the live gateway rather than in an offline benchmark.
 *
 * NFR-03/GMCP-68 §4.1: this function itself never throws. An exception or elapsed-budget
 * timeout in any stage is caught right here — the one call site every direction (request,
 * response, tools/list, per-tool quarantine) shares — and resolved to a fail-closed/fail-open
 * `PolicyDecision` via `handlePipelineFailure`, so every caller downstream of this function
 * keeps working with an ordinary decision either way.
 */
function evaluatePayload(
  text: string,
  context: Pick<PolicyContext, "direction" | "tool" | "serverTrust" | "args">,
): PolicyDecision {
  try {
    return evaluatePayloadOrThrow(text, context);
  } catch (error) {
    const stageError =
      error instanceof PipelineStageError
        ? error.stageError
        : { stage: "policy_engine" as const, errorClass: error instanceof Error ? error.constructor.name : "UnknownError", message: "unexpected pipeline failure", timedOut: false };
    return handlePipelineFailure(stageError);
  }
}

function evaluatePayloadOrThrow(
  text: string,
  context: Pick<PolicyContext, "direction" | "tool" | "serverTrust" | "args">,
): PolicyDecision {
  const startedAt = performance.now();
  const tracker = createStageBudgetTracker();
  const detections = runStage(tracker, "detection", () => detect(text));
  const { score: riskScore } = runStage(tracker, "risk_scoring", () =>
    scoreRisk(detections, context.tool, context.serverTrust),
  );
  const decision = runStage(tracker, "policy_engine", () => {
    const activePack = runtimePolicyPacks["korean-pii"];
    if (!activePack) throw new Error("Active policy pack is unavailable");
    const result = evaluate(
      resolveRuntimePolicies("korean-pii"),
      {
        ...context,
        detections: detections.map(({ type, subtype }) => ({ type, subtype })),
        riskScore,
      },
      activePack.defaultAction,
      activePack.evaluationStrategy,
    );
    return toPolicyDecision(result, detections, riskScore, context.args);
  });
  recordInspection(decision.verdict, performance.now() - startedAt);
  return decision;
}

/**
 * `evaluate()` (GMCP-7) returns matched policies but not which one decided the
 * verdict (that's GMCP-12's `decide()`, not yet on this branch). Recompute
 * the severity-max winner here so the router has a policy to source
 * severity/message/reasonCode/approval config from.
 */
function toPolicyDecision(
  result: ReturnType<typeof evaluate>,
  detections: Detection[],
  riskScore: number,
  args: Record<string, unknown>,
): PolicyDecision {
  const deciding = result.policies.reduce<Policy | undefined>(
    (strongest, policy) =>
      !strongest || actionWeight[policy.action] > actionWeight[strongest.action]
        ? policy
        : strongest,
    undefined,
  );
  // FR-SEC-04 §3.3: surface the normalized path (not the raw one — the block
  // error path already avoids echoing it) so Replay can show what the
  // path_regex condition actually matched against.
  const rawPath = extractPathArg(args);
  return {
    verdict: result.action,
    matchedPolicyIds: result.matchedPolicyIds,
    decidingPolicyId: deciding?.id ?? null,
    riskScore,
    severity: deciding?.severity ?? "info",
    // FR-GW-05 §7: an explicit policy `reasonCode` wins; otherwise fall back to the id-derived
    // token. `buildGuardBlockError` normalizes whatever lands here against the §4 enum, so an
    // unrecognized fallback (e.g. "BLOCK_ENV_FILE_READ") still resolves to a valid reasonCode.
    reasonCode:
      deciding?.reasonCode ??
      (deciding ? deciding.id.toUpperCase() : "NO_POLICY_MATCH"),
    message:
      deciding?.message ??
      "No policy matched; the pack's default action was applied.",
    detections,
    ...(rawPath !== undefined
      ? { normalizedPath: normalizePath(rawPath).normalized }
      : {}),
    ...(deciding?.approval
      ? {
          approval: {
            timeoutSeconds: deciding.approval.timeout_seconds,
            onTimeout: deciding.approval.on_timeout,
            allowMaskedApproval:
              deciding.approval.allow_masked_approval ?? false,
          },
        }
      : {}),
  };
}

/**
 * Records one blocked GuardEvent per quarantined tool so the console and the audit
 * trail show which descriptor was poisoned (GMCP-66 acceptance criterion), and returns
 * each tool's decision so the caller can fold it into the response summary.
 *
 * Each event is built from that tool's **own** inspected text: its digest is the digest
 * of that text (the §8.4 meaning of `argsDigest`), and its detections are only the ones
 * found in it, so their offsets stay valid against the payload the event refers to.
 * The recorded verdict is `block` because the gateway did remove the tool, while
 * `matchedPolicyIds` reports whichever real policies matched — the quarantine is a
 * structural defense, so it never invents a policy ID that no pack declares.
 */
function recordQuarantine(
  metadata: ToolMetadataInspection,
  sessionId: string,
  serverId: string,
  serverTrust: ServerTrust,
): PolicyDecision[] {
  return metadata.quarantined.map((tool) => {
    const decision = evaluatePayload(tool.payload, {
      direction: "response",
      tool: tool.report.name,
      serverTrust,
      args: {},
    });
    emitGuardEvent({
      eventId: randomUUID(),
      sessionId,
      ts: new Date().toISOString(),
      direction: "response",
      toolName: tool.report.name,
      argsDigest: digest(tool.payload),
      verdict: "block",
      riskScore: decision.riskScore,
      matchedPolicyIds: decision.matchedPolicyIds,
      detections: tool.detections.map(toEventDetection),
      // The gateway did remove the tool, so the recorded reason reads as a block
      // regardless of what the sanitized payload's own verdict turns out to be.
      explanation: explainDecision(decision, "block"),
      targetServerId: serverId,
      targetServerTrust: serverTrust,
    });
    return decision;
  });
}

/**
 * Folds the quarantine into the summary the Agent reads. Without this a request that
 * silently lost tools still reported `allow` with an empty policy list, and a client
 * that switches on `verdict` — as the demo agent does — could not tell that anything
 * had happened. A quarantine raises the summary to at least `warn`.
 */
function summarizeWithQuarantine(
  decision: PolicyDecision,
  quarantineDecisions: PolicyDecision[],
  metadata: ToolMetadataInspection,
): ReturnType<typeof legacySummary> & {
  quarantinedTools: QuarantinedToolReport[];
} {
  const summary = legacySummary(decision);
  const quarantinedTools = metadata.quarantined.map(({ report }) => report);
  if (quarantinedTools.length === 0) return { ...summary, quarantinedTools };
  const verdict =
    actionWeight[summary.verdict] > actionWeight.warn
      ? summary.verdict
      : "warn";
  return {
    ...summary,
    verdict,
    riskScore: Math.max(
      summary.riskScore,
      ...quarantineDecisions.map(({ riskScore }) => riskScore),
    ),
    policyIds: [
      ...new Set([
        ...summary.policyIds,
        ...quarantineDecisions.flatMap(
          ({ matchedPolicyIds }) => matchedPolicyIds,
        ),
      ]),
    ],
    quarantinedTools,
  };
}

// GMCP-30 acceptance criterion 3 requires the demo response to expose the policy id,
// detections, and risk score; the readiness probe asserts detections.length >= 2. The
// action-router refactor (GMCP-15) dropped detections from this summary, so restore
// them. Detection carries only type/subtype/tag/offsets/confidence — never raw text
// (NFR-04) — and mirrors the GuardEvent wire shape that already exposes spans.
function legacySummary(decision: PolicyDecision): {
  verdict: Action;
  riskScore: number;
  policyIds: string[];
  detections: Detection[];
} {
  return {
    verdict: decision.verdict,
    riskScore: decision.riskScore,
    policyIds: decision.matchedPolicyIds,
    detections: decision.detections,
  };
}

function sessionIdOf(body: Record<string, unknown>): string {
  return typeof body.sessionId === "string"
    ? body.sessionId
    : `req-${String(body.id ?? randomUUID())}`;
}

function resolveRuntimePolicies(
  packName: string,
  resolving = new Set<string>(),
): Policy[] {
  if (resolving.has(packName))
    throw new Error(`Runtime policy-pack cycle at ${packName}`);
  const pack = runtimePolicyPacks[packName];
  if (!pack) throw new Error(`Unknown runtime policy pack ${packName}`);
  const next = new Set(resolving).add(packName);
  const inherited = pack.extends.flatMap((reference) =>
    resolveRuntimePolicies(reference.split("@")[0] ?? reference, next),
  );
  return [
    ...new Map(
      [...inherited, ...pack.policies].map((policy) => [policy.id, policy]),
    ).values(),
  ];
}

async function readJson(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
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

function sendReadError(
  response: ServerResponse,
  error: unknown,
  jsonRpc: boolean,
): void {
  if (error instanceof PayloadTooLargeError) {
    send(
      response,
      413,
      jsonRpc
        ? rpcError(null, -32013, "Payload too large")
        : { code: "PAYLOAD_TOO_LARGE" },
    );
  } else if (jsonRpc && error instanceof UpstreamError) {
    send(response, 502, rpcError(null, error.rpcCode, error.message));
  } else if (jsonRpc) {
    send(response, 400, rpcError(null, -32700, "Parse error"));
  } else {
    send(response, 400, { code: "INVALID_JSON" });
  }
}

function rpcError(
  id: unknown,
  code: number,
  message: string,
  data?: unknown,
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

/** FR-GW-05 §3.1: `GuardBlockError` already carries `code`/`message`/`data`, so it *is* the JSON-RPC error object. */
function rpcBlockError(
  id: unknown,
  error: GuardBlockError,
): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reconstructs send_email's `subject`/`body` for the upstream call from the decision made
 * against their joined inspection text. Every verdict but `mask_then_allow` left both fields
 * untouched, so the originals pass straight through unexamined. For `mask_then_allow`,
 * `detections` (offsets into the joined `${subject}${EMAIL_FIELD_SEPARATOR}${body}` text) are
 * partitioned back onto `subject`/`body` by that same arithmetic and each field is masked
 * independently via `mask()`'s own offset splicing — never by searching the (already-masked)
 * joined text for the separator, which a masked span can consume outright and a multi-line
 * `subject` would spoof even when nothing was detected in it at all.
 *
 * A detection whose span crosses the join boundary (e.g. an injection phrase the rules match
 * across a real newline — GMCP-26 review) is clipped into up to two: `maskedAs` lands on
 * whichever part fell in each field, so neither field ever carries the other's raw text and
 * neither silently drops its half of the match.
 */
function resolveEmailFields(
  verdict: Action,
  subject: string | undefined,
  body: string,
  detections: Detection[],
): { subject?: string; body: string } {
  if (verdict !== "mask_then_allow")
    return subject !== undefined ? { subject, body } : { body };
  const subjectLen = subject?.length ?? 0;
  const bodyOffset = subjectLen + EMAIL_FIELD_SEPARATOR.length;
  const subjectDetections: Detection[] = [];
  const bodyDetections: Detection[] = [];
  for (const detection of detections) {
    if (detection.end <= subjectLen) {
      subjectDetections.push(detection);
    } else if (detection.start >= bodyOffset) {
      bodyDetections.push({
        ...detection,
        start: detection.start - bodyOffset,
        end: detection.end - bodyOffset,
      });
    } else {
      if (detection.start < subjectLen)
        subjectDetections.push({ ...detection, end: subjectLen });
      if (detection.end > bodyOffset)
        bodyDetections.push({
          ...detection,
          start: Math.max(0, detection.start - bodyOffset),
          end: detection.end - bodyOffset,
        });
    }
  }
  const maskedBody = mask(body, bodyDetections);
  return subject !== undefined
    ? { subject: mask(subject, subjectDetections), body: maskedBody }
    : { body: maskedBody };
}

async function checkTcpDependencies(): Promise<
  Array<{ target: string; reachable: boolean }>
> {
  const targets = (process.env.DEPENDENCY_TCP ?? "")
    .split(",")
    .map((target) => target.trim())
    .filter(Boolean);
  return Promise.all(
    targets.map(async (target) => {
      const separator = target.lastIndexOf(":");
      const host = target.slice(0, separator);
      const targetPort = Number(target.slice(separator + 1));
      if (!host || !Number.isInteger(targetPort))
        return { target, reachable: false };
      return { target, reachable: await tcpReachable(host, targetPort) };
    }),
  );
}

function tcpReachable(host: string, targetPort: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port: targetPort });
    const done = (reachable: boolean) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(750);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/** Structured log line (NFR-06); carries no payload text. */
function logEvent(level: "info" | "warn", message: string): void {
  process.stdout.write(
    `${JSON.stringify({ level, service: "gateway", message })}\n`,
  );
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

if (process.env.NODE_ENV !== "test") {
  createServer(handler).listen(port, "0.0.0.0", () => {
    process.stdout.write(
      `${JSON.stringify({ level: "info", service: "gateway", port, message: "listening" })}\n`,
    );
  });
}
