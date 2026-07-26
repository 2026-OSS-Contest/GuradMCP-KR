"use client";

import { ReplayProvider } from "./replay-provider";
import { SessionList } from "./session-list";
import { TimelineColumn } from "./timeline-column";
import { DetailColumn } from "./detail-column";

/** SCR-301 Replay — three columns (session list · timeline · event detail), spec §5.3. */
export function ReplayScreen({ sessionId, eventId }: { sessionId?: string; eventId?: string }) {
  return (
    <ReplayProvider initialSessionId={sessionId} initialEventId={eventId}>
      {/* relative so the detail slide-over can float over the timeline below 1280 (spec §4.5). */}
      <div data-scr="SCR-301" className="relative flex min-h-0 flex-1 overflow-hidden">
        <SessionList />
        <TimelineColumn />
        <DetailColumn />
      </div>
    </ReplayProvider>
  );
}
