import { HttpResponse, delay, http, sse } from "msw";
import type {
  ApprovalDecision,
  AttackRunMode,
  AttackScenariosResponse,
  DetectDirection,
  Overview,
  RecentEventsResponse,
  SecurityEvent,
  ServersResponse,
  SessionsResponse,
  TimelineResponse
} from "@/lib/api/types";
import { allApprovals, decide, raiseApproval, resetApprovals, resolveRaised } from "./approvals";
import { EMPTY_OVERVIEW, SERVERS, liveEvent, overviewOf, recentEvents } from "./data";
import { ATTACK_SCENARIOS, attackRun } from "./attack-lab";
import { previewOf } from "./detect";
import {
  DRY_RUN_STATS,
  POLICY_YAML,
  currentPacks,
  currentPolicies,
  policyYaml,
  seedPolicies,
  togglePack,
  togglePolicy
} from "./policies";
import { SESSIONS, policyDetail, revealOf, timelineOf } from "./replay";
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
    | SessionsResponse
    | TimelineResponse
    | AttackScenariosResponse
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

  http.get("*/api/v1/servers", async () => respond({ servers: readScenario() === "empty" ? [] : SERVERS })),

  http.get("*/api/v1/events/recent", async () => respond({ events: readScenario() === "empty" ? [] : recentEvents() })),

  // SCR-301 Replay (spec §5.3). Empty scenario has no recorded sessions.
  http.get("*/api/v1/sessions", async () => respond({ sessions: readScenario() === "empty" ? [] : SESSIONS })),

  http.get("*/api/v1/sessions/:id/timeline", async ({ params }) =>
    respond(timelineOf(String(params.id)))
  ),

  // SCR-201 Attack Lab (spec §5.2). The catalogue is static; unavailable scenarios still list so
  // the picker can show them as 준비 중.
  http.get("*/api/v1/attacklab/scenarios", async () => respond({ scenarios: ATTACK_SCENARIOS })),

  // The real endpoint only queues the run (the runner is GMCP-55); the mock plays it out and
  // returns the finished result the panes render. The delay stands in for that execution.
  http.post("*/api/v1/attacklab/run/:id", async ({ params, request }) => {
    const mode = (new URL(request.url).searchParams.get("mode") ?? "guarded") as AttackRunMode;
    await delay(600);
    if (readScenario() === "offline") return HttpResponse.error();
    const run = attackRun(String(params.id), mode);
    return run
      ? HttpResponse.json(run)
      : HttpResponse.json({ code: "scenario_not_found", message: "unknown or unavailable scenario" }, { status: 404 });
  }),

  // SCR-401 Detector (spec §5.4). The control plane serves this for real; the mock covers the
  // detectors the design draws (RRN, secrets) that the seeded pack does not reach yet.
  http.post("*/api/v1/detect/preview", async ({ request }) => {
    const direction = (new URL(request.url).searchParams.get("direction") ?? "request") as DetectDirection;
    const { text } = (await request.json()) as { text?: string };
    await delay(LATENCY_MS);
    if (readScenario() === "offline") return HttpResponse.error();
    if (!text?.trim()) {
      return HttpResponse.json({ code: "invalid_preview_text", message: "text must not be blank" }, { status: 400 });
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
  // Dry-run is the exception: no endpoint serves it (GMCP-77), so this path exists here only.
  // It is registered ahead of `/policies/:id` below, or that parameter swallows it.
  http.get("*/api/v1/policies/dry-run-stats", async () => {
    await delay(LATENCY_MS);
    if (readScenario() === "offline") return HttpResponse.error();
    return HttpResponse.json({ stats: readScenario() === "empty" ? [] : DRY_RUN_STATS });
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
    return HttpResponse.json(id in POLICY_YAML ? { id, yaml: policyYaml(id) } : policyDetail(id));
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
    const emitter = (client as unknown as Record<symbol, { on?: (type: string, fn: () => void) => void }>)[
      Symbol.for("kClientEmitter")
    ];
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
      if (readScenario() !== "empty") {
        if (seq % 3 === 0) {
          raiseApproval();
          client.send({ event: "approval.created", data: { id: `apr-${seq}` } });
        } else if (seq % 3 === 1) {
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
  })
];
