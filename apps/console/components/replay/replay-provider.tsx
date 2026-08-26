"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getEvent, getSessions, getSessionTimeline } from "@/lib/api/client";
import type { EventDetail, SessionSummary, TimelineEvent, TimelineResponse } from "@/lib/api/types";
import { useResource, type Resource } from "@/lib/api/use-resource";

/**
 * Shared SCR-301 selection state. The session list (left), the timeline (centre, GMCP-11) and
 * the event detail panel (right, GMCP-34) all read and drive selection through this, so
 * clicking a session or a timeline node updates every column at once (spec §5.3).
 */
interface ReplayContextValue {
  sessions: Resource<{ sessions: SessionSummary[] }>;
  selectedSession: SessionSummary | undefined;
  selectSession: (id: string) => void;
  timeline: Resource<TimelineResponse>;
  events: TimelineEvent[];
  selectedEventId: string | undefined;
  selectEvent: (id: string) => void;
  selectedDetail: EventDetail | undefined;
  live: boolean;
}

const ReplayContext = createContext<ReplayContextValue | null>(null);

/** The event a freshly opened session lands on: its first verdict node, else its first event. */
function defaultEventId(events: TimelineEvent[]): string | undefined {
  return (events.find((event) => event.type === "verdict") ?? events[0])?.id;
}

export function ReplayProvider({
  children,
  initialSessionId,
  initialEventId
}: {
  children: ReactNode;
  /** From the /replay/[sessionId] route; falls back to the live or first session. */
  initialSessionId?: string;
  /** From ?event= on a deep link (spec §3). */
  initialEventId?: string;
}) {
  const sessions = useResource((signal) => getSessions(signal));
  const list = sessions.data?.sessions ?? [];

  /**
   * Whether the route's session id is one the control plane will answer for.
   *
   * It often is not, and the reason is a genuine id-space split rather than a stale link.
   * `GET /events/recent` reports the gateway's own opaque session id — `req-s-envdemo`,
   * `attacklab-1a2b` — straight off the ingested record, while Replay addresses sessions by
   * `UUID.nameUUIDFromBytes("guardmcp-session:" + raw)` and `GET /sessions/{id}/timeline` 404s on
   * anything that is not a UUID. So every deep link out of SCR-101's recent-events feed names a
   * session this screen cannot load.
   */
  const routeSessionKnown = Boolean(initialSessionId) && list.some((session) => session.id === initialSessionId);

  /**
   * The bridge between the two id spaces, and the reason this is a console-side fix at all:
   * **event** ids are the same on both sides. `GET /events/{eventId}` answers with the session's
   * *UUID* (`EventLookupResponse.sessionId`), so one lookup turns a link the timeline endpoint
   * would refuse into one it will serve.
   *
   * Deriving the UUID here instead would mean reimplementing `nameUUIDFromBytes` — an MD5 digest
   * with the version and variant bits rewritten — in the browser, and then owning a copy of a
   * hashing scheme the control plane is free to change. Asking the control plane which session an
   * event belongs to cannot drift.
   *
   * Only ever on the failing path: a route that names a session the list contains never spends
   * the request, which is every link inside the console and every fixture.
   */
  const needsLookup = Boolean(initialEventId) && list.length > 0 && !routeSessionKnown;
  const lookup = useResource(
    (signal) =>
      needsLookup && initialEventId ? getEvent(initialEventId, signal) : Promise.resolve(undefined),
    { key: needsLookup ? `deep-link:${initialEventId}` : "deep-link:none" }
  );
  /**
   * Read off the payload's own event id rather than off `lookup.loading`, which cannot answer
   * this: `useResource` sets `loading` false when a request settles and never back to true when
   * its `key` changes. The first pass here resolves `undefined` (the list has not arrived, so
   * there is nothing to look up yet) and leaves `loading` false for good — so a `loading` gate
   * would have been open during the exact window it exists to close, and the fallback below
   * would settle on the live session before the real answer landed.
   */
  const looked = lookup.data;
  const resolvedSessionId =
    needsLookup && looked !== undefined && looked.id === initialEventId ? looked.sessionId : undefined;
  /** Still asking. Settling onto another session now would throw the deep link away mid-flight. */
  const resolving = needsLookup && !resolvedSessionId && !lookup.error;

  const [sessionId, setSessionId] = useState<string | undefined>(initialSessionId);
  // Once sessions load, settle on a selection if the route did not name a valid one.
  useEffect(() => {
    if (!list.length) return;
    if (sessionId && list.some((session) => session.id === sessionId)) return;
    // A lookup in flight is not yet a failure. Falling back to the live session here is what used
    // to make a recent-events deep link open on the wrong session and drop its `?event=` — which
    // reads as "the link worked" and is worse than an error.
    if (resolving) return;
    const resolved = resolvedSessionId
      ? list.find((session) => session.id === resolvedSessionId)
      : undefined;
    setSessionId((resolved ?? list.find((session) => session.live) ?? list[0]).id);
  }, [list, sessionId, resolving, resolvedSessionId]);

  const selectedSession = list.find((session) => session.id === sessionId);

  // Skip the request until a session is chosen, so the initial render never hits
  // `/sessions//timeline`; `key` refetches as soon as `sessionId` settles.
  const timeline = useResource(
    (signal) => (sessionId ? getSessionTimeline(sessionId, signal) : Promise.resolve({ events: [], details: {} })),
    { key: sessionId }
  );
  const events = useMemo(() => (sessionId ? (timeline.data?.events ?? []) : []), [sessionId, timeline.data]);
  const details = timeline.data?.details ?? {};

  const [eventOverride, setEventOverride] = useState<string | undefined>(initialEventId);
  // Reset the selection when the session (and therefore the timeline) changes — but only when it
  // actually changes. Firing on mount as well threw away every `?event=` deep link before its
  // timeline had even loaded, so a link from SCR-101 always opened on the session's first verdict
  // instead of the event it named (spec §3). It looked correct while the only verdict a fixture
  // had was the one being linked to (GMCP-117).
  const shownSession = useRef(sessionId);
  useEffect(() => {
    if (shownSession.current === sessionId) return;
    // Except when the change *is* the deep link resolving. That transition is the link arriving
    // at the session it always named, not the reader moving off it, so the event it asked for
    // has to survive — clearing here would undo the lookup a line after it succeeded.
    const arrivedByLookup = sessionId !== undefined && sessionId === resolvedSessionId;
    shownSession.current = sessionId;
    if (!arrivedByLookup) setEventOverride(undefined);
  }, [sessionId, resolvedSessionId]);

  const selectedEventId =
    eventOverride && events.some((event) => event.id === eventOverride) ? eventOverride : defaultEventId(events);
  const selectedDetail = selectedEventId ? details[selectedEventId] : undefined;

  const value: ReplayContextValue = {
    sessions,
    selectedSession,
    selectSession: setSessionId,
    timeline,
    events,
    selectedEventId,
    selectEvent: setEventOverride,
    selectedDetail,
    live: Boolean(selectedSession?.live)
  };

  return <ReplayContext.Provider value={value}>{children}</ReplayContext.Provider>;
}

export function useReplay(): ReplayContextValue {
  const value = useContext(ReplayContext);
  if (!value) throw new Error("useReplay must be used inside <ReplayProvider>");
  return value;
}
