import { HttpResponse, delay, http, sse } from "msw";
import type {
  AttackRunMode,
  AttackScenariosResponse,
  Overview,
  RecentEventsResponse,
  SecurityEvent,
  ServersResponse,
  SessionsResponse,
  TimelineResponse
} from "@/lib/api/types";
import { EMPTY_OVERVIEW, SERVERS, liveEvent, overviewOf, recentEvents } from "./data";
import { ATTACK_SCENARIOS, attackRun } from "./attack-lab";
import { SESSIONS, policyDetail, revealOf, timelineOf } from "./replay";
import { readScenario } from "./scenario";

// Long enough that a slow render is visible, short enough that the 500ms skeleton rule
// (spec §4.2) keeps skeletons off the screen on a healthy connection.
const LATENCY_MS = 250;

/** How often the live stream pushes a new event. */
const STREAM_INTERVAL_MS = 4_000;

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

  // Policy Chip popover (spec §3). Not gated by scenario — a chip resolves even offline-ish.
  http.get("*/api/v1/policies/:id", async ({ params }) => {
    await delay(LATENCY_MS);
    return HttpResponse.json(policyDetail(String(params.id)));
  }),

  // Reveal-original (spec §5.3 no.5). POST — the real endpoint writes an audit record.
  http.post("*/api/v1/events/:id/reveal", async () => {
    await delay(LATENCY_MS);
    return HttpResponse.json(revealOf());
  }),

  // The gateway event stream (spec §6.3). Real backends emit several event types; SCR-101 only
  // consumes `guard.event`, so that is all the mock pushes. A named event maps onto the
  // client's `addEventListener("guard.event", …)`, and objects are JSON-serialised for it.
  sse<{ "guard.event": SecurityEvent }>("*/api/v1/events/stream", ({ client, request }) => {
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
      client.send({ event: "guard.event", data: liveEvent(seq++) });
    }, STREAM_INTERVAL_MS);
  })
];
