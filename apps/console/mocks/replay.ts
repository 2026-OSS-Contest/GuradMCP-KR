// SCR-301 Replay fixtures. These are shaped as the real GMCP-28 wire contract (`Api*` types) —
// the same JSON services/control-plane returns — so `lib/api/replay-adapter.ts` runs identically
// against the mock and a real backend, and dev mode never drifts from what prod actually serves.
//
// The sessions themselves come from `mocks/demo-story.ts`: one incident that every screen tells
// the same way (GMCP-117). Nothing session-shaped is defined here any more — this file only
// turns the story into wire nodes, and derives the session list from those nodes so a count on
// the list can never disagree with the timeline behind it.

import type {
  ApiEventLookupResponse,
  ApiRevealResponse,
  ApiSessionSummary,
  ApiSessionTimelineResponse,
  ApiTimelineNode,
  Verdict
} from "@/lib/api/types";
import { LIVE_SESSION_ID, STORIES, stepAt, storyOf, type Story, type StoryStep } from "./demo-story";

function toNode(story: Story, step: StoryStep): ApiTimelineNode {
  return {
    eventId: step.id,
    type: step.type,
    ts: stepAt(story, step),
    summary: step.summary,
    ...(step.toolName ? { toolName: step.toolName } : {}),
    ...(step.direction ? { direction: step.direction } : {}),
    ...(step.argsDigest ? { argsDigest: step.argsDigest } : {}),
    ...(step.argsJson ? { argsJson: step.argsJson } : {}),
    ...(step.agentSummary ? { agentSummary: step.agentSummary } : {}),
    ...(step.content ? { content: step.content } : {}),
    ...(step.directionVerdict ? { directionVerdict: step.directionVerdict } : {}),
    ...(step.verdict ? { verdict: step.verdict } : {}),
    ...(step.riskScore === undefined ? {} : { riskScore: step.riskScore }),
    // `maskDiffRef` is the URL the design has the Mask Diff view fetch separately. Nothing
    // implements that route (see the note on `ApiVerdictDetail`), so the diff travels inline and
    // this is filled in here for contract shape alone rather than repeated in the story.
    detail: step.detail ? { ...step.detail, maskDiffRef: `/api/v1/events/${step.id}/mask-diff` } : null,
    // GMCP-84 §8.3: true only where the story can actually name the body behind the event
    // (`StoryStep.detail.rawPayload`). It used to be true for every VERDICT node, which made
    // `원문 열람` live on all of them while `revealOf()` answered the same ticket regardless of
    // which one was asked — so the modal drew a body that had nothing to do with the event's own
    // findings, and the 409 `raw_payload_not_stored` path (the *default*, since NFR-04 stores no
    // raw copy unless the opt-in is on) could not be reached in dev at all.
    hasRawPayload: Boolean(step.detail?.rawPayload)
  };
}

const nodesOf = (story: Story): ApiTimelineNode[] => story.steps.map((step) => toNode(story, step));

/** Counted from the nodes rather than stated: a summary that can drift is a summary that will. */
function summarise(story: Story): ApiSessionSummary {
  const verdictSummary: Record<Verdict, number> = { allow: 0, warn: 0, require_approval: 0, block: 0 };
  for (const step of story.steps) if (step.verdict) verdictSummary[step.verdict] += 1;
  const last = story.steps[story.steps.length - 1];
  return {
    sessionId: story.sessionId,
    agentLabel: story.agentLabel,
    startedAt: stepAt(story, story.steps[0]),
    endedAt: story.isLive ? null : stepAt(story, last),
    isLive: story.isLive,
    eventCount: story.steps.length,
    verdictSummary
  };
}

export const sessions = (): ApiSessionSummary[] => STORIES.map(summarise);

export function timelineOf(sessionId: string): ApiSessionTimelineResponse {
  const story = storyOf(sessionId);
  if (!story) {
    return {
      sessionId,
      agentLabel: "claude-code-cli",
      startedAt: new Date().toISOString(),
      isLive: false,
      chainStatus: "valid",
      nodes: [],
      nextCursor: null
    };
  }
  return {
    sessionId: story.sessionId,
    agentLabel: story.agentLabel,
    startedAt: stepAt(story, story.steps[0]),
    isLive: story.isLive,
    chainStatus: "valid",
    nodes: nodesOf(story),
    nextCursor: null
  };
}

/** GET /events/{id}: any node of any session, so a deep link resolves wherever it points. */
export function eventLookup(eventId: string): ApiEventLookupResponse | undefined {
  for (const story of STORIES) {
    const step = story.steps.find((candidate) => candidate.id === eventId);
    if (step) return { sessionId: story.sessionId, ...toNode(story, step) };
  }
  return undefined;
}

/**
 * POST /events/{id}/reveal (spec §5.3 no.5) — the audited look at what the tool actually
 * returned. The gateway keeps no raw copy of its own (NFR-04); this stands in for the one place
 * the design says an operator may see it, with a record left behind.
 *
 * Answers `AuditEventController.RevealResponse` — the control plane's shape, not the modal's, so
 * `reveal-adapter.ts` runs here exactly as it does in production. It used to answer the modal's
 * `RevealContent` directly, which is a shape no backend has ever produced: the reveal worked in
 * dev and would have handed the modal `content.raw === undefined` against a real one.
 *
 * `undefined` where the event has no stored payload — the handler turns that into the 409
 * `raw_payload_not_stored` a real control plane answers with.
 */
export function revealOf(eventId: string): ApiRevealResponse | undefined {
  for (const story of STORIES) {
    const step = story.steps.find((candidate) => candidate.id === eventId);
    if (!step) continue;
    if (!step.detail?.rawPayload) return undefined;
    return {
      eventId,
      rawPayload: step.detail.rawPayload,
      // No console build carries a real identity yet (`lib/api/permissions.ts`); the control
      // plane stamps whatever `X-Actor-Id` reached it, defaulting to this.
      revealedBy: "operator",
      revealedAt: new Date().toISOString()
    };
  }
  return undefined;
}

export const LIVE_SESSION = LIVE_SESSION_ID;
