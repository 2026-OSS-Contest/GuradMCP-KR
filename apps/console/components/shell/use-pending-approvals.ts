"use client";

import { useEffect, useState } from "react";
import { createSseClient } from "@/lib/sse";
import { MOCK_API } from "@/mocks/scenario";

// Same stream the rest of the console consumes: same-origin under the mock, the real gateway
// when one is configured, and nothing to connect to without either.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;
const STREAM_URL = API_BASE ? `${API_BASE}/api/v1/events/stream` : MOCK_API ? "/api/v1/events/stream" : null;

/**
 * Live pending-approval count for the SCR-000 status-bar badge (spec §4.1).
 *
 * The 10s `/overview` poll stays authoritative — it seeds the count and reconciles any drift —
 * while `approval.created` / `approval.resolved` events move it in between polls, so the badge
 * reacts the moment an approval is raised or resolved instead of waiting up to ten seconds.
 */
export function usePendingApprovals(polled: number, polledAt: Date | undefined): number {
  const [delta, setDelta] = useState(0);

  // Every fresh poll is the source of truth; drop the interim SSE delta so it cannot accumulate.
  useEffect(() => setDelta(0), [polledAt]);

  useEffect(() => {
    if (!STREAM_URL) return;
    const client = createSseClient({
      url: STREAM_URL,
      onMessage: (message) => {
        if (message.type === "approval.created") setDelta((d) => d + 1);
        else if (message.type === "approval.resolved") setDelta((d) => d - 1);
      }
    });
    return () => client.close();
  }, []);

  // A poll and an unfilled resolved event could momentarily disagree; never show a negative.
  return Math.max(0, polled + delta);
}
