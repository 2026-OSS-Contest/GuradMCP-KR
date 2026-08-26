"use client";

import { useEffect, useState } from "react";
import { createSseClient } from "@/lib/sse";

// Same stream the rest of the console consumes: an absolute URL when NEXT_PUBLIC_API_BASE_URL
// points at a backend directly, same-origin otherwise. The relative form covers both the mock
// (MSW answers it) and the real control plane reached through next.config.ts's `/api/v1/*`
// rewrite (fix-api.md §2) — the deployment this console actually ships with (docker-compose.yml
// sets CONTROL_PLANE_URL, not NEXT_PUBLIC_API_BASE_URL), so this must not require MOCK_API to be
// true or the stream never connects in that mode. `createSseClient` shares one connection per
// URL, so the status bar does not add an EventSource to every screen.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;
const STREAM_URL = `${API_BASE ?? ""}/api/v1/events/stream`;

/** A `approval.created` (+1) or `approval.resolved` (-1), stamped with when it reached us. */
interface Change {
  at: number;
  delta: number;
}

/**
 * Live pending-approval count for the SCR-000 status-bar badge (spec §4.1).
 *
 * The 10s `/overview` poll stays authoritative and `approval.created` / `approval.resolved`
 * move the badge in between, so it reacts the moment an approval is raised instead of waiting
 * out the interval.
 *
 * @param polled      the count the last successful poll reported
 * @param requestedAt when that poll's request was sent — the cut-off for what it can reflect
 */
export function usePendingApprovals(polled: number, requestedAt: Date | undefined): number {
  const [changes, setChanges] = useState<Change[]>([]);

  // Discard only what the snapshot already counts: a change that landed before its request went
  // out. Dropping everything would also discard changes that arrived while it was in flight —
  // the snapshot cannot contain those, and their paired resolve would later subtract from a
  // count that never included them, leaving the badge wrong until the following poll.
  const snapshotAt = requestedAt?.getTime();
  useEffect(() => {
    if (snapshotAt === undefined) return;
    setChanges((previous) => {
      const kept = previous.filter((change) => change.at >= snapshotAt);
      return kept.length === previous.length ? previous : kept;
    });
  }, [snapshotAt]);

  useEffect(() => {
    if (!STREAM_URL) return;
    const client = createSseClient({
      url: STREAM_URL,
      onStatusChange: (status) => {
        // A drop means an unknown number of missed changes, so anything held is no longer
        // trustworthy; fall back to the poll until it reports again.
        if (status === "reconnecting") setChanges([]);
      },
      onMessage: (message) => {
        const delta = message.type === "approval.created" ? 1 : message.type === "approval.resolved" ? -1 : 0;
        if (delta === 0) return;
        setChanges((previous) => [...previous, { at: Date.now(), delta }]);
      }
    });
    return () => client.close();
  }, []);

  const delta = changes.reduce((sum, change) => sum + change.delta, 0);
  // A resolve can still outrun the create it pairs with across a reconnect; never show negative.
  return Math.max(0, polled + delta);
}
