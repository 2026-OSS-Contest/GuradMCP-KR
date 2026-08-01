import { HttpResponse, delay, http, sse } from "msw";
import type {
  ApiSessionsResponse,
  ApiSessionTimelineResponse,
  ApprovalDecision,
  AttackRunMode,
  AttackScenariosResponse,
  DetectDirection,
  Overview,
  RecentEventsResponse,
  SecurityEvent,
  ServersResponse,
} from "@/lib/api/types";
import { allApprovals, decide, raiseApproval, resetApprovals, resolveRaised } from "./approvals";
import { EMPTY_OVERVIEW, SERVERS, liveEvent, overviewOf, recentEvents } from "./data";
import { ATTACK_SCENARIOS, attackRun } from "./attack-lab";
import { previewOf } from "./detect";
import {
  SESSIONS,
  eventLookup,
  policyDetail,
  revealOf,
  timelineOf,
} from "./replay";
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
    respond({ servers: readScenario() === "empty" ? [] : SERVERS }),
  ),

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

  // Deep-link support (spec §3.3): a single node lookup by eventId.
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

  // The gateway event stream (spec §6.3). Real backends emit several event types; the console
  // consumes `guard.event` (SCR-101 recent events) and `approval.created`/`approval.resolved`
  // (the SCR-000 status-bar pending badge, spec §4.1). A named event maps onto the client's
  // `addEventListener(type, …)`, and objects are JSON-serialised for it.
  sse<{
    "guard.event": SecurityEvent;
    "approval.created": { id: string };
    "approval.resolved": { id: string };
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
      if (readScenario() !== "empty") {
        if (seq % 3 === 0) {
          raiseApproval();
          client.send({ event: "approval.created", data: { id: `apr-${seq}` } });
        } else if (seq % 3 === 1) {
          resolveRaised();
          client.send({ event: "approval.resolved", data: { id: `apr-${seq - 1}` } });
        }
      }
      seq += 1;
    }, STREAM_INTERVAL_MS);
  }),
];
