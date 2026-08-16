import { HttpResponse, delay, http, sse } from "msw";
import {
  TRUST_RANK,
  type ApiSessionsResponse,
  type ApiSessionTimelineResponse,
  type ApprovalDecision,
  type AttackRunMode,
  type AttackScenariosResponse,
  type DetectDirection,
  type Overview,
  type RecentEventsResponse,
  type SecurityEvent,
  type ServersResponse,
  type ServerTrustChangeRequest,
} from "@/lib/api/types";
import { allApprovals, decide, raiseApproval, resetApprovals, resolveRaised } from "./approvals";
import { ATTACK_SCENARIOS, attackRun } from "./attack-lab";
import { acknowledgeToolDiff, allDiffsOf, pendingDiffsOf, reapproveToolDiffs } from "./tool-diffs";

import { previewOf } from "./detect";
import {
  POLICY_YAML,
  currentPacks,
  currentPolicies,
  policyStats,
  policyYaml,
  seedPolicies,
  togglePack,
  togglePolicy,
} from "./policies";
import {
  EMPTY_OVERVIEW,
  SERVERS,
  affectedPolicyCount,
  liveEvent,
  overviewOf,
  recentEvents,
} from "./data";
import {
  SESSIONS,
  eventLookup,
  policyDetail,
  revealOf,
  timelineOf,
} from "./replay";
import { currentSettings, patchSettings } from "./settings";
import { readScenario } from "./scenario";

// Long enough that a slow render is visible, short enough that the 500ms skeleton rule
// (spec §4.2) keeps skeletons off the screen on a healthy connection.
const LATENCY_MS = 250;

/** How often the live stream pushes a new event. */
const STREAM_INTERVAL_MS = 4_000;

/** Stream ticks between `policy.reloaded` events — every 10th, so roughly once a minute. */
const POLICY_RELOAD_EVERY = 10;

/** `offline` fails at the network level, which is what a down gateway looks like to fetch(). */
async function respond(
  payload:
    | Overview
    | ServersResponse
    | RecentEventsResponse
    | ApiSessionsResponse
    | ApiSessionTimelineResponse
    | AttackScenariosResponse,
) {
  await delay(LATENCY_MS);
  if (readScenario() === "offline") return HttpResponse.error();
  return HttpResponse.json(payload);
}

export const handlers = [
  http.get("*/api/v1/overview", async () => {
    const empty = readScenario() === "empty";
    return respond(empty ? EMPTY_OVERVIEW : overviewOf(SERVERS));
  }),

  http.get("*/api/v1/servers", async () =>
    // The trust handler below writes back into `SERVERS`, so the inventory has to read from the
    // same array — a second mutable copy would let the table and the change disagree.
    respond({ servers: readScenario() === "empty" ? [] : SERVERS }),
  ),

  // SCR-501 Settings (spec §5.7). GMCP-68's `SettingsController` serves this for real; the mock
  // stands in for it under MSW (dev/e2e), same as every other handler in this file.
  http.get("*/api/v1/settings", async () => {
    await delay(LATENCY_MS);
    if (readScenario() === "offline") return HttpResponse.error();
    return HttpResponse.json(currentSettings());
  }),

  http.put("*/api/v1/settings", async ({ request }) => {
    const update = (await request.json()) as Record<string, unknown>;
    await delay(LATENCY_MS);
    if (readScenario() === "offline") return HttpResponse.error();
    // Mirrors the real SettingsController's server-side guard (GMCP-68 REQ-08): the client's own
    // checkbox already gates this, but the mock has to enforce it too or a client bug that drops
    // `riskAcknowledged` would look identical to a correct one under every existing test.
    if (update.failMode === "fail_open" && update.riskAcknowledged !== true) {
      return HttpResponse.json(
        { code: "risk_not_acknowledged", message: "fail_open requires riskAcknowledged=true" },
        { status: 400 }
      );
    }
    return HttpResponse.json(patchSettings(update));
  }),

  // FR-GW-02 §5.1: downgrade applies immediately; an upgrade needs a follow-up confirmed:true
  // request or 409s with an impact summary. Mirrors services/control-plane's ServerController.
  http.put("*/api/v1/servers/:id/trust", async ({ params, request }) => {
    await delay(LATENCY_MS);
    if (readScenario() === "offline") return HttpResponse.error();
    const server = SERVERS.find(
      (candidate) => candidate.id === String(params.id),
    );
    if (!server)
      return HttpResponse.json(
        { code: "server_not_found", message: "server not found" },
        { status: 404 },
      );

    const body = (await request.json()) as ServerTrustChangeRequest;
    const toTrust = body.trustLevel;
    if (toTrust === server.trust)
      return HttpResponse.json({
        id: server.id,
        name: server.name,
        connected: server.connected,
        trust: server.trust,
      });

    const isUpgrade = TRUST_RANK[toTrust] > TRUST_RANK[server.trust];
    if (isUpgrade && !body.confirmed) {
      return HttpResponse.json(
        {
          code: "upgrade_requires_confirmation",
          message: `upgrading ${server.id} to ${toTrust} requires confirmation`,
          details: {
            fromTrust: server.trust,
            toTrust,
            affectedPolicyCount: String(affectedPolicyCount(server.id)),
          },
        },
        { status: 409 },
      );
    }
    server.trust = toTrust;
    return HttpResponse.json({
      id: server.id,
      name: server.name,
      connected: server.connected,
      trust: server.trust,
    });
  }),

  // SCR-101 snapshot diff popover (FR-GW-03 §6.2/§6.3). Mirrors ToolSnapshotController.kt.
  http.get("*/api/v1/servers/:id/tools/:toolName/diffs", async ({ request, params }) => {
    await delay(LATENCY_MS);
    if (readScenario() === "offline") return HttpResponse.error();
    const toolName = String(params.toolName);
    const serverId = String(params.id);
    const includeAcknowledged = new URL(request.url).searchParams.get("includeAcknowledged") === "true";
    const diffs = includeAcknowledged ? allDiffsOf(serverId, toolName) : pendingDiffsOf(serverId, toolName);
    return HttpResponse.json({ toolName, diffs });
  }),

  http.post("*/api/v1/servers/:id/tools/:toolName/diffs/:diffId/acknowledge", async ({ params }) => {
    await delay(LATENCY_MS);
    if (readScenario() === "offline") return HttpResponse.error();
    const serverId = String(params.id);
    const toolName = String(params.toolName);
    const diff = acknowledgeToolDiff(serverId, toolName, String(params.diffId));
    if (!diff) return HttpResponse.json({ code: "tool_diff_not_found", message: "diff not found" }, { status: 404 });

    // The real control plane derives `snapshotStatus` fresh from the diff table on every
    // GET /servers (ServerController.kt's toolInventory); this fixture is static, so mirror
    // that derivation here. Acknowledging never touches the baseline (§6.3), so the last
    // pending diff clearing does not mean `in_sync` — it means `drift_acknowledged` until a
    // reapprove actually moves the baseline (see the reapprove handler below).
    const server = SERVERS.find((candidate) => candidate.id === serverId);
    const tool = server?.tools.find((candidate) => candidate.name === toolName);
    if (tool) {
      const remaining = pendingDiffsOf(serverId, toolName);
      tool.snapshotStatus = {
        ...tool.snapshotStatus,
        state: remaining.length > 0 ? "drift_detected" : "drift_acknowledged",
        pendingDiffCount: remaining.length,
        latestDiffId: remaining[0]?.id ?? null,
      };
    }
    return HttpResponse.json(diff);
  }),

  http.post("*/api/v1/servers/:id/tools/:toolName/reapprove", async ({ params }) => {
    await delay(LATENCY_MS);
    if (readScenario() === "offline") return HttpResponse.error();
    const serverId = String(params.id);
    const toolName = String(params.toolName);
    const server = SERVERS.find((candidate) => candidate.id === serverId);
    const tool = server?.tools.find((candidate) => candidate.name === toolName);
    if (!tool) return HttpResponse.json({ code: "tool_not_observed", message: "no observation for tool" }, { status: 404 });

    reapproveToolDiffs(serverId, toolName);
    tool.snapshotStatus = {
      state: "in_sync",
      snapshotCapturedAt: new Date().toISOString(),
      lastCheckedAt: tool.snapshotStatus.lastCheckedAt,
      pendingDiffCount: 0,
      latestDiffId: null,
    };
    return HttpResponse.json({ approved: true, tools: [{ toolName, description: "" }] });
  }),

  http.get("*/api/v1/events/recent", async () =>
    respond({ events: readScenario() === "empty" ? [] : recentEvents() }),
  ),

  // SCR-301 Replay (GMCP-28 wire contract). Empty scenario has no recorded sessions.
  http.get("*/api/v1/sessions", async () =>
    respond({
      items: readScenario() === "empty" ? [] : SESSIONS,
      nextCursor: null,
    }),
  ),

  http.get("*/api/v1/sessions/:id/timeline", async ({ params }) =>
    respond(timelineOf(String(params.id))),
  ),

  // SCR-201 Attack Lab (spec §5.2). The catalogue is static; unavailable scenarios still list so
  // the picker can show them as 준비 중.
  http.get("*/api/v1/attacklab/scenarios", async () =>
    respond({ scenarios: ATTACK_SCENARIOS }),
  ),

  // The real endpoint only queues the run (the runner is GMCP-55); the mock plays it out and
  // returns the finished result the panes render. The delay stands in for that execution.
  http.post("*/api/v1/attacklab/run/:id", async ({ params, request }) => {
    const mode = (new URL(request.url).searchParams.get("mode") ??
      "guarded") as AttackRunMode;
    await delay(600);
    if (readScenario() === "offline") return HttpResponse.error();
    const run = attackRun(String(params.id), mode);
    return run
      ? HttpResponse.json(run)
      : HttpResponse.json(
          {
            code: "scenario_not_found",
            message: "unknown or unavailable scenario",
          },
          { status: 404 },
        );
  }),

  // SCR-401 Detector (spec §5.4). The control plane serves this for real; the mock covers the
  // detectors the design draws (RRN, secrets) that the seeded pack does not reach yet.
  http.post("*/api/v1/detect/preview", async ({ request }) => {
    const direction = (new URL(request.url).searchParams.get("direction") ??
      "request") as DetectDirection;
    const { text } = (await request.json()) as { text?: string };
    await delay(LATENCY_MS);
    if (readScenario() === "offline") return HttpResponse.error();
    if (!text?.trim()) {
      return HttpResponse.json(
        { code: "invalid_preview_text", message: "text must not be blank" },
        { status: 400 },
      );
    }
    return HttpResponse.json(previewOf(text, direction));
  }),

  // SCR-402 Approval Console (spec §5.6), served by the control plane today.
  // A bare array, and no `status` filter — the real endpoint has no bucket covering the four
  // terminal statuses, so the console asks for everything and splits it. The mock matches that
  // rather than the shape the console would have preferred.
  http.get("*/api/v1/approvals", async () => {
    resetApprovals(readScenario() === "empty");
    await delay(LATENCY_MS);
    if (readScenario() === "offline") return HttpResponse.error();
    return HttpResponse.json(allApprovals());
  }),

  http.post("*/api/v1/approvals/:id/decision", async ({ params, request }) => {
    const { decision } = (await request.json()) as { decision: ApprovalDecision };
    await delay(LATENCY_MS);
    if (readScenario() === "offline") return HttpResponse.error();
    const done = decide(String(params.id), decision);
    // Already decided, or the 120s timeout beat the operator to it — the API answers 409 and the
    // console reports it rather than retrying.
    return done
      ? HttpResponse.json(done)
      : HttpResponse.json({ code: "approval_already_resolved", message: "already decided" }, { status: 409 });
  }),

  // SCR-302 Policy Builder (spec §5.5), served by the control plane's `PolicyController`. Both
  // GETs answer with a bare array, and both writes are PUT — the mock matches that rather than
  // the envelope the screen would have preferred.
  //
  // Per-policy stats are GMCP-80's `GET /policies/{policyId}/stats`, not built yet — the mock is
  // the only server. Registered ahead of `/policies/:id`, whose parameter would otherwise take it.
  http.get("*/api/v1/policies/:id/stats", async ({ params }) => {
    await delay(LATENCY_MS);
    if (readScenario() === "offline") return HttpResponse.error();
    return HttpResponse.json(policyStats(String(params.id)));
  }),

  // An empty console has no packs loaded at all, which is the screen's empty state.
  http.get("*/api/v1/policy-packs", async () => {
    seedPolicies(readScenario() === "empty");
    await delay(LATENCY_MS);
    if (readScenario() === "offline") return HttpResponse.error();
    return HttpResponse.json(currentPacks());
  }),

  http.get("*/api/v1/policies", async () => {
    seedPolicies(readScenario() === "empty");
    await delay(LATENCY_MS);
    if (readScenario() === "offline") return HttpResponse.error();
    return HttpResponse.json(currentPolicies());
  }),

  // `PolicyUpdateRequest` takes action/severity/priority; `enabled` is the console's own
  // addition, which the real endpoint would accept and ignore. Here it is what actually moves.
  http.put("*/api/v1/policies/:id", async ({ params, request }) => {
    const { enabled } = (await request.json()) as { enabled?: boolean };
    await delay(LATENCY_MS);
    if (readScenario() === "offline") return HttpResponse.error();
    if (enabled === undefined) return new HttpResponse(null, { status: 400 });
    const row = togglePolicy(String(params.id), enabled);
    return row ? HttpResponse.json(row) : new HttpResponse(null, { status: 404 });
  }),

  http.put("*/api/v1/policy-packs/:id", async ({ params, request }) => {
    const { enabled } = (await request.json()) as { enabled: boolean };
    await delay(LATENCY_MS);
    if (readScenario() === "offline") return HttpResponse.error();
    const pack = togglePack(String(params.id), enabled);
    return pack ? HttpResponse.json(pack) : new HttpResponse(null, { status: 404 });
  }),

  // Policy Chip popover (spec §3), and the SCR-302 YAML pane. Not gated by scenario — a chip
  // resolves even offline-ish. The policy catalogue answers first; the replay fixtures keep
  // serving the older synthetic ids their timelines still reference.
  http.get("*/api/v1/policies/:id", async ({ params }) => {
    const id = String(params.id);
    await delay(LATENCY_MS);
    if (id in POLICY_YAML) return HttpResponse.json({ id, yaml: policyYaml(id) });
    // The replay fixtures still reference older synthetic ids and their chips must resolve.
    if (id.startsWith("mask_kr") || id.startsWith("deny_")) return HttpResponse.json(policyDetail(id));
    // Anything else has no source to serve — which is every policy against a real gateway.
    return new HttpResponse(null, { status: 404 });
  }),

  // Reveal-original (spec §5.3 no.5). POST — the real endpoint writes an audit record.
  http.post("*/api/v1/events/:id/reveal", async () => {
    await delay(LATENCY_MS);
    return HttpResponse.json(revealOf());
  }),

  // The gateway event stream (spec §6.3). Real backends emit several event types; the console
  // consumes `guard.event` (SCR-101 recent events), `approval.created`/`approval.resolved`
  // (the SCR-000 status-bar pending badge, spec §4.1) and `policy.reloaded` (the SCR-302
  // hot-reload banner). A named event maps onto the client's `addEventListener(type, …)`, and
  // objects are JSON-serialised for it.
  sse<{
    "guard.event": SecurityEvent;
    "approval.created": { id: string };
    "approval.resolved": { id: string };
    "policy.reloaded": { packId: string };
  }>("*/api/v1/events/stream", ({ client, request }) => {
    if (readScenario() === "offline") return void client.error();

    // request.signal never aborts for an intercepted EventSource in the browser, so the only
    // reliable disconnect signal is the client's own "close"/"error" event (fired when the
    // stream is cancelled). Without stopping on it the interval leaks and, once the underlying
    // controller is torn down, throws "enqueue into a closed stream" on every tick.
    let live = true;
    const stop = () => {
      live = false;
      clearInterval(timer);
    };
    const emitter = (
      client as unknown as Record<
        symbol,
        { on?: (type: string, fn: () => void) => void }
      >
    )[Symbol.for("kClientEmitter")];
    emitter?.on?.("close", stop);
    emitter?.on?.("error", stop);
    request.signal.addEventListener("abort", stop);

    let seq = 0;
    const timer = setInterval(() => {
      if (!live) return;
      // The scenario can flip to offline while connected; mirror a gateway going down.
      if (readScenario() === "offline") {
        stop();
        return client.error();
      }
      client.send({ event: "guard.event", data: liveEvent(seq) });
      // Move the status-bar pending badge over SSE (spec §4.1): raise one approval, then resolve
      // it a tick later, so the count visibly changes between the 10s /overview polls. The
      // ledger moves with the event, so the next /overview agrees with what was just sent.
      // An empty console has no approvals to raise, so the stream stays quiet there.
      //
      // Once per connection, not on a loop. The pair is a demonstration that the badge follows
      // the stream, and one showing makes it; repeating it every third tick also put a card into
      // SCR-402's queue and took it out again for as long as the screen was open, which reads as
      // the list glitching rather than as an approval arriving. Same reasoning as the reload
      // event below — a call to action that arrives every few seconds is noise.
      if (readScenario() !== "empty") {
        if (seq === 0) {
          raiseApproval();
          client.send({ event: "approval.created", data: { id: `apr-${seq}` } });
        } else if (seq === 1) {
          resolveRaised();
          client.send({ event: "approval.resolved", data: { id: `apr-${seq - 1}` } });
        }
      }
      // Someone edited a pack on disk and the gateway reloaded it. Rare on purpose: the SCR-302
      // banner it raises is a call to action, and one arriving every few seconds is noise.
      if (seq > 0 && seq % POLICY_RELOAD_EVERY === 0) {
        // The gateway names the pack it reloaded; the console only needs to know one did.
        client.send({ event: "policy.reloaded", data: { packId: currentPacks()[0]?.id ?? "default" } });
      }
      seq += 1;
    }, STREAM_INTERVAL_MS);
  }),

  // Deep-link support (spec §3.3): a single node lookup by eventId. Registered after the
  // `/events/stream` sse() handler (which is itself a GET matcher) so a literal ":id" path
  // param can never shadow the stream route — MSW resolves handlers in array order, first match
  // wins.
  http.get("*/api/v1/events/:id", async ({ params }) => {
    await delay(LATENCY_MS);
    const event = eventLookup(String(params.id));
    return event
      ? HttpResponse.json(event)
      : HttpResponse.json(
          { code: "event_not_found", message: "unknown eventId" },
          { status: 404 },
        );
  }),
];
