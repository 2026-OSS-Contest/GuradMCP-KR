// Converts the GMCP-28 backend wire contract (`Api*` types) into the view-model the SCR-301
// components already render (`SessionSummary`, `TimelineEvent`, `EventDetail`). Keeping this
// conversion in one place is what lets those components stay unaware of the wire shape.

import type {
  ApiEventLookupResponse,
  ApiSessionsResponse,
  ApiSessionSummary,
  ApiSessionTimelineResponse,
  ApiTimelineNode,
  ApiTimelineNodeType,
  ChainStatus,
  Detection,
  EventDetail,
  SessionsResponse,
  SessionSummary,
  TimelineEvent,
  TimelineNodeType,
  TimelineResponse,
  Verdict
} from "./types";

const NODE_TYPE: Record<ApiTimelineNodeType, TimelineNodeType> = {
  USER_INPUT: "user",
  AGENT_STEP: "agent",
  TOOL_CALL: "tool_call",
  VERDICT: "verdict",
  RESULT: "result"
};

/** Fixed judgement order (PROJECT.md 5.3): verdict badges always stack in this order. */
const VERDICT_ORDER: Verdict[] = ["allow", "warn", "require_approval", "block"];

export function toSessionSummary(api: ApiSessionSummary): SessionSummary {
  return {
    id: api.sessionId,
    startedAt: api.startedAt,
    live: api.isLive,
    eventCount: api.eventCount,
    verdicts: VERDICT_ORDER.filter((verdict) => api.verdictSummary[verdict] > 0).map((verdict) => ({
      verdict,
      count: api.verdictSummary[verdict]
    }))
  };
}

export function toSessionsResponse(api: ApiSessionsResponse): SessionsResponse {
  return { sessions: api.items.map(toSessionSummary) };
}

/**
 * Kinds that plausibly carry maskable original content. Reveal-eligibility is a client-side
 * policy, not part of the GMCP-28 timeline contract — POST /events/{id}/reveal is a separate,
 * still-unimplemented endpoint, so this only decides whether the button offers to try it.
 */
function canReveal(kind: TimelineNodeType): boolean {
  return kind === "user" || kind === "verdict" || kind === "result";
}

function toTimelineEvent(node: ApiTimelineNode): TimelineEvent {
  return {
    id: node.eventId,
    type: NODE_TYPE[node.type],
    at: node.ts,
    title: node.summary,
    verdict: node.verdict,
    policy: node.detail?.matchedPolicyIds[0]
  };
}

/**
 * `contextToolName` and `chainStatus` come from the session's full node list (see
 * `toTimelineResponse`) — a lone VERDICT/RESULT node never carries a toolName itself, and a
 * chain's validity is a property of the whole session, not of one node.
 */
export function toEventDetail(
  node: ApiTimelineNode,
  sessionId: string,
  contextToolName: string | undefined,
  chainStatus: ChainStatus | undefined
): EventDetail {
  const kind = NODE_TYPE[node.type];
  const detail = node.detail;
  return {
    id: node.eventId,
    sessionId,
    at: node.ts,
    kind,
    verdict: node.verdict ?? "allow",
    tool: node.toolName ?? contextToolName ?? node.summary,
    policies: detail?.matchedPolicyIds,
    threatScore: node.riskScore,
    detections: detail?.detections.map(
      (d): Detection => ({ type: d.type, subtype: d.subtype, confidence: Math.round(d.confidence * 100) })
    ),
    chain: detail && chainStatus ? { status: chainStatus, hash: detail.hash } : undefined,
    canReveal: canReveal(kind)
    // body/call/direction/maskDiff/reveal: no source in this API yet, left undefined — see the
    // GMCP-28 wire contract note in ./types.ts.
  };
}

export function toTimelineResponse(api: ApiSessionTimelineResponse): TimelineResponse {
  const events: TimelineEvent[] = [];
  const details: Record<string, EventDetail> = {};
  let lastToolName: string | undefined;

  for (const node of api.nodes) {
    if (node.type === "TOOL_CALL") lastToolName = node.toolName;
    events.push(toTimelineEvent(node));
    // "unknown" carries no evidence either way, so the pill is left off entirely — the same
    // rule `toEventDetailFromLookup` applies below. Defaulting it to "verified" would put a
    // green badge on a session nothing has actually verified.
    const chainStatus: ChainStatus | undefined =
      api.chainStatus === "unknown"
        ? undefined
        : api.chainStatus === "broken" && api.brokenAt === node.eventId
          ? "failed"
          : "verified";
    details[node.eventId] = toEventDetail(node, api.sessionId, lastToolName, chainStatus);
  }
  return { events, details };
}

/**
 * GET /events/{id}: standalone, so there is no sibling TOOL_CALL or session-wide chain status to
 * draw on. Without the session's chainStatus/brokenAt we have no evidence either way, so the
 * chain pill is left undefined rather than claiming "verified" — a fabricated verified badge on
 * a deep-linked, possibly-tampered session is worse than showing nothing.
 */
export function toEventDetailFromLookup(api: ApiEventLookupResponse): EventDetail {
  return toEventDetail(api, api.sessionId, api.toolName, undefined);
}
