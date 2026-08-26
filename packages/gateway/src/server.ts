import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
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
import { syncPolicyRegistry } from "./controlPlane/policySync.js";
import { detect, mask, type Detection } from "./detect.js";
import { adjudicate, adjudicationEnabled, isBorderline } from "./llm/adjudicator.js";
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
  Explanation,
  GuardBlockError,
  PolicyDecision,
  ServerTrust,
} from "./pipeline/types.js";
import { logJson } from "./pipeline/logger.js";
import { loadBootSnapshot } from "./policy/policy-loader.js";
import { PolicyStore } from "./policy/policy-store.js";
import { startPolicyWatcher } from "./policy/policy-watcher.js";
import { scoreRisk } from "./risk.js";
import { getServerTrust, startServerRegistrySync } from "./server-registry.js";
import { startFailurePolicySync } from "./settings/failurePolicyCache.js";
import {
  getToolSnapshotBaseline,
  reportToolObservation,
  startToolSnapshotSync,
} from "./tool-snapshot-registry.js";
import {
  computeFingerprint,
  diffToolDefinitions,
  extractToolDefinitions,
  type ToolDefinitionDiff,
  type ToolDiffType,
} from "./tool-snapshot.js";

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

const controlPlaneUrl = process.env.CONTROL_PLANE_URL;
// Shared secret the Control Plane's `security.sync-token` gates POST /policies/sync with
// (docker-compose.yml wires the same POLICY_SYNC_TOKEN value into both services) — see
// policySync.ts's own doc. Unset by default, same as REVEAL_OPERATOR_TOKEN.
const policySyncToken = process.env.POLICY_SYNC_TOKEN;
startServerRegistrySync(controlPlaneUrl);
// NFR-03/GMCP-68 §4.3: cache starts cold (fail-closed) until the first snapshot arrives.
startFailurePolicySync(controlPlaneUrl);
// Operator-tunable (spec §11: "폴링 주기와 지연"), for the same reason the upstream tools/list
// interval is configurable in spec §5.2 — a short interval speeds up a demo/attack-lab run at
// the cost of more frequent Control Plane polling.
const toolSnapshotSyncIntervalMs = Number(
  process.env.TOOL_SNAPSHOT_SYNC_INTERVAL_MS ?? 60_000,
);
startToolSnapshotSync(
  controlPlaneUrl,
  gatewayServerId,
  toolSnapshotSyncIntervalMs,
);

// FR-POL-03 §3/§6: the pipeline evaluates through PolicyStore.getSnapshot(), never a static
// import, so an edit under policy-packs/ takes effect on the next Tool Call without a restart.
// korean-pii is the pack the pipeline evaluates against; it `extends: [default]`
// (policy-packs/korean-pii/pack.yaml), so this is the same effective policy set the old static
// wiring (`runtimePolicyPacks["korean-pii"]`) evaluated.
const ACTIVE_POLICY_PACK_ID = "korean-pii";

// A source checkout (`src/server.ts` under tsx) and a locally-built `dist/server.js` both sit
// three directories under the repo root, so this default resolves correctly either way. The
// Docker image flattens `packages/gateway/dist` to `/app/dist` (see Dockerfile), which is why
// production sets POLICY_PACKS_DIR explicitly instead of relying on this default.
const defaultPolicyPacksDir = fileURLToPath(
  new URL("../../../policy-packs", import.meta.url),
);
const policyPacksDir = process.env.POLICY_PACKS_DIR ?? defaultPolicyPacksDir;

// §6 step 3: boot failure (a required pack missing or broken) is fatal — fail-closed by exiting
// rather than serving traffic with no usable policy set.
const bootLoad = await loadBootSnapshot(policyPacksDir);
for (const error of bootLoad.registry.getAllErrors()) {
  logJson(error.level === "critical" ? "error" : "warn", "policy load error", {
    file: error.file,
    ruleId: error.ruleId,
    message: error.message,
    level: error.level,
  });
}
if (bootLoad.fatal) {
  logJson("error", "gateway boot aborted: a required policy pack failed to load", {
    policyPacksDir,
  });
  process.exit(1);
}
const policyStore = new PolicyStore(bootLoad.snapshot);
// fix-api.md §1: report the real, just-loaded pack/policy set to the Control Plane so
// `GET /policies`/`GET /policy-packs` stop serving a hardcoded seed. Boot pushes once
// immediately; the watcher below pushes again after every hot-reload.
syncPolicyRegistry(controlPlaneUrl, bootLoad.registry, policySyncToken);
// The watcher holds an open chokidar handle (fs watches + a debounce timer), which would leak
// across the test suite for no benefit — tests exercise PolicyWatcher directly instead
// (policy-watcher.test.ts), the same way ./pipeline/auditPublisher.ts gates its own bus
// subscription and the tail of this file gates `createServer(...).listen(...)`.
if (process.env.NODE_ENV !== "test") {
  startPolicyWatcher(policyPacksDir, policyStore, {
    activePackId: ACTIVE_POLICY_PACK_ID,
    controlPlaneUrl,
    syncToken: policySyncToken,
  });
}

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
    const activeSnapshot = policyStore.getSnapshot();
    send(response, 200, {
      service: "gateway",
      ...metricsSnapshot(),
      audit: auditPublisherMetrics(),
      // FR-POL-03: observable proof a hot-reload landed, without exposing policy content.
      policy: {
        version: activeSnapshot.version,
        loadedAt: activeSnapshot.loadedAt.toISOString(),
        policyCount: activeSnapshot.registry.getActivePolicyCount(),
      },
    });
    return;
  }
  if (request.method === "POST" && request.url === "/inspect") {
    try {
      const body = await readJson(request);
      const text =
        typeof body.text === "string" ? body.text : JSON.stringify(body);
      const decision = await evaluatePayloadAdjudicated(text, {
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
    // Rug Pull drift detection (FR-GW-03, T-05): compares the sanitized tool list against
    // the last-approved baseline. Runs on the already-quarantined payload — a quarantined
    // tool is excluded from the comparison entirely (see detectAndReportDrift), not reported
    // as `tool_removed`; it is still on the upstream server, just hidden from the Agent this
    // round, and FR-GW-04's own `block` GuardEvent already covers it. Reporting it as removed
    // too would be a second, misleading event for the same tool.
    const driftDiffs = detectAndReportDrift(
      metadata,
      sessionId,
      gatewayServerId,
      serverTrust,
    );
    const payload = JSON.stringify(metadata.sanitized);
    const decision = await evaluatePayloadAdjudicated(payload, {
      direction: "response",
      tool: "tools/list",
      serverTrust,
      args: {},
    });
    const summary = summarizeWithQuarantine(
      decision,
      quarantineDecisions,
      metadata,
      driftDiffs,
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
      // Keep the quarantine and any drift visible even when the sanitized payload blocks
      // for its own reasons; otherwise the Agent loses the record of which tools were
      // removed or changed.
      send(response, 200, {
        jsonrpc: "2.0",
        id,
        error: {
          ...routed.error,
          data: {
            ...routed.error.data,
            quarantinedTools: summary.quarantinedTools,
            driftedTools: summary.driftedTools,
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
    const requestDecision = await evaluatePayloadAdjudicated(requestPayload, {
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
    const responseDecision = await evaluatePayloadAdjudicated(responsePayload, {
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
/**
 * FR-INJ-04 (GMCP-57). The rule verdict, then an optional second opinion on it.
 *
 * `evaluatePayload` below stays synchronous and stays the source of the verdict; this
 * only wraps it. With the adjudicator off — the default, and the only mode CI runs —
 * this is `evaluatePayload` plus one boolean, which is what "no hard dependency"
 * has to mean structurally rather than by configuration.
 *
 * A confident `injection` answer raises the verdict to `require_approval`: the model
 * is a reason to put a human in front of a borderline call, not a reason to decide it.
 * It can never lower one — see ./llm/adjudicator.ts.
 */
async function evaluatePayloadAdjudicated(
  text: string,
  context: Pick<PolicyContext, "direction" | "tool" | "serverTrust" | "args">,
): Promise<PolicyDecision> {
  const decision = evaluatePayload(text, context);
  if (!adjudicationEnabled() || !isBorderline(decision.riskScore)) return decision;
  const adjudication = await adjudicate(text, decision.riskScore);
  if (!adjudication) return decision;
  if (!adjudication.escalated) return { ...decision, llmAdjudication: adjudication };
  return {
    ...decision,
    verdict: actionWeight[decision.verdict] >= actionWeight.require_approval ? decision.verdict : "require_approval",
    severity: decision.severity === "critical" ? decision.severity : "high",
    reasonCode: "LLM_ADJUDICATED_INJECTION",
    message: `경계 구간 판정을 ${adjudication.model}이 인젝션으로 분류해 승인 대기로 올렸습니다.`,
    llmAdjudication: adjudication,
  };
}

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
        : {
            stage: "policy_engine" as const,
            errorClass:
              error instanceof Error ? error.constructor.name : "UnknownError",
            message: "unexpected pipeline failure",
            timedOut: false,
          };
    return handlePipelineFailure(stageError);
  }
}

function evaluatePayloadOrThrow(
  text: string,
  context: Pick<PolicyContext, "direction" | "tool" | "serverTrust" | "args">,
): PolicyDecision {
  const startedAt = performance.now();
  // FR-POL-03 §4.3: read the active snapshot once, up front, and thread it through the rest of
  // this (fully synchronous) function. A concurrent `PolicyStore.swap()` can never be observed
  // mid-evaluation this way — this call either sees the pre-reload or the post-reload snapshot,
  // never a mix of the two.
  const snapshot = policyStore.getSnapshot();
  const tracker = createStageBudgetTracker();
  const detections = runStage(tracker, "detection", () => detect(text));
  const { score: riskScore } = runStage(tracker, "risk_scoring", () =>
    scoreRisk(detections, context.tool, context.serverTrust),
  );
  const decision = runStage(tracker, "policy_engine", () => {
    const activePack = snapshot.registry.getPack(ACTIVE_POLICY_PACK_ID);
    if (!activePack) throw new Error("Active policy pack is unavailable");
    const result = evaluate(
      snapshot.registry.resolvePolicies(ACTIVE_POLICY_PACK_ID),
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

const driftRiskScore = 55;

const driftLabels: Record<ToolDiffType, { ko: string; en: string }> = {
  tool_added: { ko: "새 Tool이 추가되었습니다", en: "a new tool appeared" },
  tool_removed: {
    ko: "기존 Tool이 사라졌습니다",
    en: "an existing tool disappeared",
  },
  description_changed: {
    ko: "Tool 설명이 변경되었습니다",
    en: "the tool description changed",
  },
  schema_changed: {
    ko: "Tool 입력 스키마가 변경되었습니다",
    en: "the tool input schema changed",
  },
};

/**
 * Neutral, factual wording (FR-GW-03 §11 UX principle): this reports that a definition
 * differs from what was approved, not that an attack occurred — a legitimate version
 * upgrade looks identical to a Rug Pull at this layer, and only an operator reviewing the
 * diff can tell them apart.
 */
function explainDrift(diff: ToolDefinitionDiff): Explanation {
  const label = driftLabels[diff.diffType];
  return {
    reasonCode: "tool_definition_drift",
    ko: `Tool '${diff.toolName}'의 정의가 승인 시점과 달라졌습니다 (${label.ko}).`,
    en: `Tool '${diff.toolName}' differs from its approved definition (${label.en}).`,
  };
}

/**
 * Compares the sanitized `tools/list` response against the locally cached approved
 * baseline (FR-GW-03 §5.2) and, for each drift found, emits a `require_approval`
 * GuardEvent through the normal pipeline — matching `attack-lab/scenarios/catalog.json`
 * A-09's `expectedControl.verdict`. A server with no approved baseline is skipped
 * entirely (§5.1.3: "승인 전까지는 diff 비교 대상에서 제외"), so a server nobody has
 * reviewed yet never generates drift noise.
 *
 * A tool FR-GW-04 quarantined this round is excluded from the comparison, not just from
 * `metadata.sanitized`: `extractToolDefinitions` never sees it, so without this exclusion
 * it would read as `tool_removed` against the baseline — a false drift signal for a tool
 * that is still on the upstream server and already has its own `block` GuardEvent from
 * `recordQuarantine`. Excluding it here means the baseline simply isn't compared against
 * for that tool this round, rather than being told it disappeared.
 *
 * The tool list plus any diffs are also reported to the Control Plane so its
 * `GET /servers` inventory and `lastCheckedAt` stay current — see
 * `tool-snapshot-registry.ts`'s `reportToolObservation` for why that call is
 * fire-and-forget rather than something this function awaits.
 *
 * Returns the diffs found so the caller can fold them into the `tools/list` response's
 * `_guardmcp` summary (see `summarizeWithQuarantine`) — emitting the GuardEvent alone left
 * the drift recorded in the audit trail but invisible in the response actually handed back
 * to the Agent, which is indistinguishable from A-09's fail condition ("조용히 반영된다").
 */
function detectAndReportDrift(
  metadata: ToolMetadataInspection,
  sessionId: string,
  serverId: string,
  serverTrust: ServerTrust,
): ToolDefinitionDiff[] {
  const baseline = getToolSnapshotBaseline(serverId);
  const currentTools = extractToolDefinitions(metadata.sanitized);
  const observedTools = currentTools.map((tool) => ({
    ...tool,
    fingerprint: computeFingerprint(tool.description, tool.inputSchema),
  }));
  const quarantinedNames = new Set(
    metadata.quarantined.map((tool) => tool.report.name),
  );
  const diffs = baseline.approved
    ? diffToolDefinitions(baseline.entries, currentTools).filter(
        (diff) =>
          !(
            diff.diffType === "tool_removed" &&
            quarantinedNames.has(diff.toolName)
          ),
      )
    : [];
  for (const diff of diffs) {
    emitGuardEvent({
      eventId: randomUUID(),
      sessionId,
      ts: new Date().toISOString(),
      direction: "response",
      toolName: diff.toolName,
      argsDigest: digest(JSON.stringify(diff)),
      verdict: "require_approval",
      riskScore: driftRiskScore,
      matchedPolicyIds: [],
      detections: [],
      explanation: explainDrift(diff),
      targetServerId: serverId,
      targetServerTrust: serverTrust,
    });
  }
  reportToolObservation(controlPlaneUrl, serverId, observedTools, diffs);
  return diffs;
}

/** One drifted tool as surfaced in the `tools/list` response summary — name and diff kind
 *  only, never `before`/`after` text (NFR-04, same rule `quarantinedTools` follows: the
 *  audit trail carries the content, the response summary carries just enough to alert). */
export interface DriftedToolReport {
  name: string;
  diffType: ToolDiffType;
}

/**
 * Folds the quarantine and any Rug Pull drift into the summary the Agent reads. Without
 * this a request that silently lost tools, or whose tool definitions silently changed,
 * still reported `allow` with an empty policy list, and a client that switches on
 * `verdict` — as the demo agent does — could not tell that anything had happened.
 *
 * A quarantine raises the summary to at least `warn`; drift raises it to at least
 * `require_approval` (the same verdict already recorded on each drift's own GuardEvent —
 * see `detectAndReportDrift` — and the verdict A-09's `expectedControl` names), since a
 * changed tool definition is the thing the Agent is about to act on, not a byproduct of
 * this response like a masked span.
 */
function summarizeWithQuarantine(
  decision: PolicyDecision,
  quarantineDecisions: PolicyDecision[],
  metadata: ToolMetadataInspection,
  driftDiffs: ToolDefinitionDiff[],
): ReturnType<typeof legacySummary> & {
  quarantinedTools: QuarantinedToolReport[];
  driftedTools: DriftedToolReport[];
} {
  const summary = legacySummary(decision);
  const quarantinedTools = metadata.quarantined.map(({ report }) => report);
  const driftedTools = driftDiffs.map(({ toolName, diffType }) => ({
    name: toolName,
    diffType,
  }));
  if (quarantinedTools.length === 0 && driftedTools.length === 0) {
    return { ...summary, quarantinedTools, driftedTools };
  }
  const floor: Action =
    driftedTools.length > 0 ? "require_approval" : "warn";
  const verdict =
    actionWeight[summary.verdict] > actionWeight[floor]
      ? summary.verdict
      : floor;
  return {
    ...summary,
    verdict,
    riskScore: Math.max(
      summary.riskScore,
      ...quarantineDecisions.map(({ riskScore }) => riskScore),
      ...(driftedTools.length > 0 ? [driftRiskScore] : []),
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
    driftedTools,
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
