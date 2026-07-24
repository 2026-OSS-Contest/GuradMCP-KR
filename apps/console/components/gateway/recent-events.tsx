"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { SecurityEvent } from "@/lib/api/types";
import { createSseClient, type SseStatus } from "@/lib/sse";
import { CtaChevronIcon } from "@/components/icons/scr-101";
import { RelativeTime } from "@/components/relative-time";
import { VerdictBadge } from "@/components/verdict-badge";
import { MOCK_API } from "@/mocks/scenario";
import { cn } from "@/lib/utils";

/** Spec §5.1 no.5 — the panel holds the 20 most recent events. */
const MAX_EVENTS = 20;

// The stream is same-origin under the mock (MSW's sse() handler serves it) and points at the
// real gateway when one is configured. With neither, there is nothing to connect to.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;
const STREAM_URL = API_BASE ? `${API_BASE}/api/v1/events/stream` : MOCK_API ? "/api/v1/events/stream" : null;

/** The design widens this column only at its largest breakpoint: 315 up to 1920, then 664. */
export const EVENTS_COLUMN = "w-[315px] min-[1920px]:w-[664px]";

function EventRow({ event }: { event: SecurityEvent }) {
  return (
    <li>
      <Link
        href={`/replay/${event.sessionId}?event=${event.id}`}
        className="flex items-center gap-3 pb-4 transition-colors hover:bg-white/5 shadow-[inset_0_-1px_0_0_var(--primitive-opacity-white-alpha-10)]"
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <VerdictBadge verdict={event.verdict} />
          {/* The tool name is the point of the row — the target is what gives way when narrow. */}
          <span className="flex-none text-body-mono-b2-rg">{event.tool}</span>
          {event.target && (
            <span className="truncate text-caption-text-c-rg text-(--primitive-opacity-white-alpha-75)">
              {event.target}
            </span>
          )}
        </span>
        <RelativeTime
          at={event.at}
          className="flex-none text-caption-text-c-rg text-(--primitive-opacity-white-alpha-75)"
        />
      </Link>
    </li>
  );
}

export function RecentEvents({
  events,
  loading,
  failed,
  demoDisabled
}: {
  events: SecurityEvent[];
  loading: boolean;
  /** Nothing has ever loaded and the last attempt failed — there is no stale data to show. */
  failed: boolean;
  demoDisabled: boolean;
}) {
  const t = useTranslations("gateway.events");
  const tCta = useTranslations("gateway.cta");
  const tError = useTranslations("gateway.error");
  const [streamed, setStreamed] = useState<SecurityEvent[]>([]);
  const [status, setStatus] = useState<SseStatus>("closed");

  useEffect(() => {
    if (!STREAM_URL) return;
    const client = createSseClient({
      url: STREAM_URL,
      onStatusChange: setStatus,
      onMessage: (message) => {
        if (message.type !== "guard.event") return;
        setStreamed((previous) => [message.data as SecurityEvent, ...previous].slice(0, MAX_EVENTS));
      }
    });
    return () => client.close();
  }, []);

  // A streamed event also shows up in the next `/events/recent` poll, so drop the duplicate
  // and keep the streamed copy — it is the one already on screen.
  const merged = useMemo(() => {
    const byId = new Map<string, SecurityEvent>();
    for (const event of [...streamed, ...events]) if (!byId.has(event.id)) byId.set(event.id, event);
    return [...byId.values()].slice(0, MAX_EVENTS);
  }, [streamed, events]);

  return (
    <div className={cn("flex flex-none flex-col gap-4", EVENTS_COLUMN)}>
      <section className="flex min-h-0 flex-1 flex-col gap-4 rounded-lg bg-grayscale-900 p-4">
        <h2 className="pb-3 text-body-text-b1-md text-grayscale-300 shadow-[inset_0_-1px_0_0_var(--primitive-opacity-white-alpha-10)]">
          {t("title")}
        </h2>

        {status === "reconnecting" && <p className="text-caption-text-c-rg text-verdict-warn">{t("reconnecting")}</p>}

        {failed ? (
          <p className="text-body-text-b3-md text-grayscale-400">{tError("unreachable")}</p>
        ) : loading ? (
          <div className="flex flex-col gap-4">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="h-8 animate-pulse motion-reduce:animate-none rounded-sm bg-(--primitive-opacity-white-alpha-6)" />
            ))}
          </div>
        ) : merged.length === 0 ? (
          <p className="text-body-text-b3-md text-grayscale-400">{t("empty")}</p>
        ) : (
          <ul role="log" aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            {merged.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ul>
        )}
      </section>

      <Link
        href="/demo"
        aria-disabled={demoDisabled}
        tabIndex={demoDisabled ? -1 : undefined}
        className={cn(
          "flex h-12 flex-none items-center justify-center gap-2 rounded-lg bg-blue-800 px-6 text-body-text-b2-md transition-colors hover:bg-blue-700",
          demoDisabled && "pointer-events-none opacity-50"
        )}
      >
        {tCta("demo")}
        <CtaChevronIcon className="h-6 w-5 flex-none" aria-hidden />
      </Link>
    </div>
  );
}
