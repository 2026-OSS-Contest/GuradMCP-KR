// SCR-101 fixtures: the KPI row, the server inventory, and the recent-event feed.
//
// None of it is invented any more (GMCP-117). The servers come from `mocks/demo-story.ts`, which
// mirrors the control plane's own seed and the tools `apps/demo-mcp-tools` actually serves; the
// events are the verdicts of the sessions on SCR-301, read straight off the same story, so a row
// here always opens onto a timeline that contains it.

import type { ApiOverview, SecurityEvent } from "@/lib/api/types";
import { pendingCount } from "./approvals";
import { LIVE_SESSION_ID, SERVERS, STORIES, stepAt } from "./demo-story";

export { SERVERS };

export const POLICY_PACKS = ["default", "korean-pii"];

export function affectedPolicyCount(serverId: string): number {
  const server = SERVERS.find((candidate) => candidate.id === serverId);
  if (!server) return 0;
  return new Set(server.tools.flatMap((tool) => tool.policies)).size;
}


/**
 * `GET /overview` exactly as `OverviewController.kt` builds it — **the backend's shape, not the
 * console's**. The screens never see this: `getOverview` runs it through `toOverview()` and the
 * provider fills in the inventory, the same path a real control plane takes.
 *
 * Serving the console's own shape here was the older mistake this replaces. A mock that emits a
 * shape the system never produces makes every e2e above it assert a state the product has never
 * been in — which is how the three bugs in GMCP-117 stayed hidden.
 *
 * It takes no inventory any more, and that is the point: the server, tool and policy counts are
 * no longer *stated* here beside a table that states its own. The console derives them from the
 * same `/servers` and `/policies` responses the tables render, so `protectedTools` reading 17
 * beside an inventory of 11 (GMCP-117) is now impossible to express rather than merely fixed.
 */
export function overviewOf(): ApiOverview {
  return {
    // `protected = activePacks.isNotEmpty()` in the control plane. A single unreachable upstream
    // does not flip it — the design draws 보호 중 beside a "1개 끊김" card for exactly that case.
    protected: POLICY_PACKS.length > 0,
    // Gateways, not MCP servers, and hardcoded to 1 on the backend. The console's server card
    // counts the `/servers` inventory instead, which is a different number.
    gatewayCount: 1,
    activePolicyPacks: POLICY_PACKS,
    blockedToday: blockedToday(),
    maskedToday: maskedToday(),
    pendingApprovals: pendingCount(),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Verdicts the story actually contains, counted rather than stated — and counted **since local
 * midnight**, because that is the window the control plane uses (`truncatedTo(ChronoUnit.DAYS)`).
 * It used to be a rolling 24 hours here, which is a different set of events either side of
 * midnight and would have quietly disagreed with the real backend.
 */
function countTodayBy(verdict: string): number {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return STORIES.flatMap((story) =>
    story.steps
      .filter((step) => step.verdict === verdict)
      .filter((step) => Date.parse(stepAt(story, step)) >= midnight.getTime())
  ).length;
}

const blockedToday = () => countTodayBy("block");
/** The masking verdict's wire name is `mask_then_allow` (`GuardAction.MASK_THEN_ALLOW`). */
const maskedToday = () => countTodayBy("mask_then_allow");

/** A gateway that is up with its packs loaded and nothing registered against it yet. */
export const EMPTY_OVERVIEW: ApiOverview = {
  protected: POLICY_PACKS.length > 0,
  gatewayCount: 1,
  activePolicyPacks: POLICY_PACKS,
  blockedToday: 0,
  maskedToday: 0,
  pendingApprovals: 0,
  generatedAt: new Date().toISOString(),
};

/**
 * The feed is the story's verdicts, newest first — the same events SCR-301 replays. A row's
 * `sessionId` and the tool it names therefore always resolve: deep-linking from here lands on a
 * node that exists, which the hand-written seed this replaces could not promise.
 */
/** What `GET /events/recent` answers with by default — the design's list is a window, not a log. */
const RECENT_LIMIT = 8;

export function recentEvents(): SecurityEvent[] {
  return STORIES.flatMap((story) =>
    story.steps
      .filter((step) => step.verdict)
      .map((step) => {
        // A verdict node carries no tool of its own; the call it judged is the step before it.
        const call = [...story.steps]
          .slice(0, story.steps.indexOf(step))
          .reverse()
          .find((candidate) => candidate.type === "TOOL_CALL");
        return {
          // The node's own id: a row here deep-links to `?event=<id>`, and the replay screen
          // looks that id up in the timeline. Anything else and the link opens onto nothing.
          id: step.id,
          sessionId: story.sessionId,
          verdict: step.verdict!,
          tool: call?.toolName ?? "gateway",
          ...(targetOf(call?.argsJson) ? { target: targetOf(call?.argsJson) } : {}),
          at: stepAt(story, step)
        };
      })
  )
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, RECENT_LIMIT);
}

/** The one argument worth showing beside the tool name: a path, a recipient, a URL, a query. */
function targetOf(argsJson: string | undefined): string | undefined {
  if (!argsJson) return undefined;
  try {
    const args = JSON.parse(argsJson) as Record<string, string>;
    return args.path ?? args.to ?? args.url ?? args.query;
  } catch {
    return undefined;
  }
}

/**
 * A new event for the live stream (spec §5.1 no.5), stamped now so it sorts to the top.
 *
 * The stream replays the live session's own verdicts rather than inventing sessions the replay
 * screen has never heard of — `s-0713` used to appear here and nowhere else.
 */
export function liveEvent(seq: number): SecurityEvent {
  const feed = recentEvents().filter((event) => event.sessionId === LIVE_SESSION_ID);
  const base = feed[seq % feed.length];
  return { ...base, id: `evt-live-${seq}`, at: new Date().toISOString() };
}
