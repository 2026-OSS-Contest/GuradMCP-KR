"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getSessions, getSessionTimeline } from "@/lib/api/client";
import type { EventDetail, SessionSummary, TimelineEvent } from "@/lib/api/types";
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
  timeline: Resource<{ events: TimelineEvent[]; details: Record<string, EventDetail> }>;
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

  const [sessionId, setSessionId] = useState<string | undefined>(initialSessionId);
  // Once sessions load, settle on a selection if the route did not name a valid one.
  useEffect(() => {
    if (!list.length) return;
    if (sessionId && list.some((session) => session.id === sessionId)) return;
    setSessionId((list.find((session) => session.live) ?? list[0]).id);
  }, [list, sessionId]);

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
    shownSession.current = sessionId;
    setEventOverride(undefined);
  }, [sessionId]);

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
