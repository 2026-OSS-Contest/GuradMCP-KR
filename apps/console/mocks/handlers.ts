import { HttpResponse, delay, http, sse } from "msw";
import type { Overview, RecentEventsResponse, SecurityEvent, ServersResponse } from "@/lib/api/types";
import { EMPTY_OVERVIEW, SERVERS, liveEvent, overviewOf, recentEvents } from "./data";
import { readScenario } from "./scenario";

// Long enough that a slow render is visible, short enough that the 500ms skeleton rule
// (spec §4.2) keeps skeletons off the screen on a healthy connection.
const LATENCY_MS = 250;

/** How often the live stream pushes a new event. */
const STREAM_INTERVAL_MS = 4_000;

/** `offline` fails at the network level, which is what a down gateway looks like to fetch(). */
async function respond(payload: Overview | ServersResponse | RecentEventsResponse) {
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

  // The gateway event stream (spec §6.3). Real backends emit several event types; SCR-101 only
  // consumes `guard.event`, so that is all the mock pushes. A named event maps onto the
  // client's `addEventListener("guard.event", …)`, and objects are JSON-serialised for it.
  sse<{ "guard.event": SecurityEvent }>("*/api/v1/events/stream", ({ client, request }) => {
    // A down gateway drops the stream the same way it fails the polls.
    if (readScenario() === "offline") return void client.error();

    let seq = 0;
    const timer = setInterval(() => {
      // The scenario can flip to offline while connected; mirror a gateway going down.
      if (readScenario() === "offline") {
        clearInterval(timer);
        return client.error();
      }
      client.send({ event: "guard.event", data: liveEvent(seq++) });
    }, STREAM_INTERVAL_MS);

    request.signal.addEventListener("abort", () => clearInterval(timer));
  })
];
