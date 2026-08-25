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
  DirectionVerdict,
  EventDetail,
  SessionsResponse,
  SessionSummary,
  TimelineEvent,
  TimelineNodeType,
  TimelineResponse,
  Verdict
} from "./types";
import { hasOperatorPermissions } from "./permissions";

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
 * A VERDICT or RESULT node carries no `toolName` of its own but is *about* the TOOL_CALL before
 * it, so the design titles the panel with that tool in mono (frames `…-guard-판정-단계`,
 * `…-tool-결과-단계`). A USER_INPUT or AGENT_STEP node is not — inheriting a sibling's tool name
 * is what titled the Agent panel `read_file` (GMCP-115 A-2). Those show their own summary, and
 * `event-detail.tsx` sets it in prose type to match `…-agent-단계`.
 */
const INHERITS_TOOL_NAME: ReadonlySet<TimelineNodeType> = new Set(["tool_call", "verdict", "result"]);

/**
 * The design's tool-call panel splits the arguments into a 대상 chip and the JSON block, and
 * counts them. All three come from the one `argsJson` string rather than three mock fields; the
 * target is the path-like argument, the same one FR-SEC-04 normalizes.
 */
function toCall(argsJson: string): EventDetail["call"] {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    return { target: "", argsCount: 0, argsJson };
  }
  const target = args.path ?? args.file_path ?? args.filename ?? Object.values(args)[0];
  return { target: typeof target === "string" ? target : "", argsCount: Object.keys(args).length, argsJson };
}

function toDirection(direction: NonNullable<ApiTimelineNode["directionVerdict"]>): DirectionVerdict {
  return {
    verdict: direction.verdict,
    policy: direction.policyIds[0],
    morePolicies: direction.policyIds.length > 1 ? direction.policyIds.length - 1 : undefined
  };
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
    tool: node.toolName ?? (INHERITS_TOOL_NAME.has(kind) ? contextToolName : undefined) ?? node.summary,
    policies: detail?.matchedPolicyIds,
    threatScore: node.riskScore,
    detections: detail?.detections.map(
      (d): Detection => ({ type: d.type, subtype: d.subtype, confidence: Math.round(d.confidence * 100) })
    ),
    maskDiff: detail?.maskDiff,
    chain: detail && chainStatus ? { status: chainStatus, hash: detail.hash } : undefined,
    summary: node.agentSummary,
    body: node.content,
    call: node.argsJson === undefined ? undefined : toCall(node.argsJson),
    direction: node.directionVerdict && toDirection(node.directionVerdict),
    // GMCP-84 §8.2: the reveal button now gates on two real signals rather than a hardcoded
    // `true` — whether this event actually has a stored raw payload (`hasRawPayload`, off the
    // wire) and whether this build carries an operator identity at all
    // (`hasOperatorPermissions()`). The server is still the real trust boundary regardless
    // (`PermissionService`) — this only decides what the button offers.
    hasRawPayload: node.hasRawPayload ?? false,
    canReveal: (node.hasRawPayload ?? false) && hasOperatorPermissions()
    // normalizedPath/reveal: no source in this API yet, left undefined — see the GMCP-28 wire
    // contract note in ./types.ts.
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
  return { events, details, brokenAt: api.chainStatus === "broken" ? api.brokenAt : undefined };
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
