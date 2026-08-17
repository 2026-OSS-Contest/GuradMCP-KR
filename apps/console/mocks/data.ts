// SCR-101 fixtures: the KPI row, the server inventory, and the recent-event feed.
//
// None of it is invented any more (GMCP-117). The servers come from `mocks/demo-story.ts`, which
// mirrors the control plane's own seed and the tools `apps/demo-mcp-tools` actually serves; the
// events are the verdicts of the sessions on SCR-301, read straight off the same story, so a row
// here always opens onto a timeline that contains it.

import type { McpServer, Overview, SecurityEvent } from "@/lib/api/types";
import { pendingCount } from "./approvals";
import { ACTIVE_POLICY_IDS, LIVE_SESSION_ID, SERVERS, STORIES, stepAt } from "./demo-story";

export { SERVERS };

export const POLICY_PACKS = ["default", "korean-pii"];

export function affectedPolicyCount(serverId: string): number {
  const server = SERVERS.find((candidate) => candidate.id === serverId);
  if (!server) return 0;
  return new Set(server.tools.flatMap((tool) => tool.policies)).size;
}


/**
 * Every KPI is counted from what the other screens show. `protectedTools` used to read 17 beside
 * an inventory of 11, and `policies.active` 24 beside a table of 5 (GMCP-117): numbers a judge
 * can subtract are numbers a judge will subtract.
 */
export function overviewOf(servers: McpServer[]): Overview {
  const disconnected = servers.filter((server) => !server.connected).length;
  return {
    // The gateway reports its own health; a single unreachable upstream is not the console's
    // cue to downgrade it. The design draws "보호 중" alongside a "1개 끊김" KPI for exactly
    // this case, and `degraded` is reserved for the gateway saying so.
    status: "protected",
    servers: { total: servers.length, disconnected },
    protectedTools: servers.reduce((total, server) => total + server.tools.length, 0),
    policies: { active: ACTIVE_POLICY_IDS.length, packs: POLICY_PACKS },
    blocked24h: blockedInLast24h(),
    pendingApprovals: pendingCount(),
  };
}

/** Blocks the story actually contains, counted rather than stated. */
function blockedInLast24h(): number {
  const since = Date.now() - 24 * 60 * 60 * 1_000;
  return STORIES.flatMap((story) =>
    story.steps
      .filter((step) => step.verdict === "block")
      .filter((step) => Date.parse(stepAt(story, step)) >= since)
  ).length;
}

export const EMPTY_OVERVIEW: Overview = {
  status: "protected",
  servers: { total: 0, disconnected: 0 },
  protectedTools: 0,
  policies: { active: ACTIVE_POLICY_IDS.length, packs: POLICY_PACKS },
  blocked24h: 0,
  pendingApprovals: 0,
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
