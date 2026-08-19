"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { SecurityEvent } from "@/lib/api/types";
import { getRecentEvents } from "@/lib/api/client";
import { useDelayed } from "@/lib/api/use-resource";
import { useEventStream } from "@/lib/use-event-stream";
import { CtaChevronIcon } from "@/components/icons";
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

function EventRow({ event, isNew }: { event: SecurityEvent; isNew: boolean }) {
  return (
    // The rule belongs to the row, not to the link: it sits at the row's bottom edge, while the
    // link is only the part that highlights. Together on one element the highlight had to stretch
    // down to the rule, which is where its 16px of bottom-only padding came from — nothing above
    // the text, nothing beside it, and a tall band underneath.
    <li className="pb-2 shadow-[inset_0_-1px_0_0_var(--primitive-opacity-white-alpha-10)]">
      <Link
        href={`/replay/${event.sessionId}?event=${event.id}`}
        className={cn(
          // -mx-2 against px-2: the highlight reaches 8px past the text on each side without
          // moving the text, so the row still lines up with the panel's other columns.
          "-mx-2 flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-white/5",
          // A freshly streamed event fades in from a highlight (spec §6.3).
          isNew && "event-tint motion-reduce:animate-none"
        )}
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

export function RecentEvents({ demoDisabled }: { demoDisabled: boolean }) {
  const t = useTranslations("gateway.events");
  const tCta = useTranslations("gateway.cta");
  const tError = useTranslations("gateway.error");

  // The stream owns the list: it seeds from `/events/recent`, keeps it live over SSE, and
  // re-polls that same endpoint on recovery so a dropped connection loses no events.
  const { events, status, fresh, loading, failed } = useEventStream<SecurityEvent>({
    streamUrl: STREAM_URL,
    backfill: async (signal) => (await getRecentEvents(signal)).events,
    getId: (event) => event.id,
    getTime: (event) => Date.parse(event.at),
    max: MAX_EVENTS
  });

  // Spec §4.2: a response under 500ms must not flash a skeleton.
  const pending = useDelayed(loading);
  // Only surface the unreachable state when there is no data to fall back to.
  const unreachable = failed && events.length === 0;

  return (
    <div className={cn("flex flex-none flex-col gap-4", EVENTS_COLUMN)}>
      <section className="flex min-h-0 flex-1 flex-col gap-4 rounded-xl bg-grayscale-900 p-4">
        <h2 className="pb-3 text-body-text-b1-md text-grayscale-300 shadow-[inset_0_-1px_0_0_var(--primitive-opacity-white-alpha-10)]">
          {t("title")}
        </h2>

        {status === "reconnecting" && <p className="text-caption-text-c-rg text-verdict-warn">{t("reconnecting")}</p>}

        {unreachable ? (
          <p className="text-body-text-b3-md text-grayscale-400">{tError("unreachable")}</p>
        ) : pending ? (
          <div className="flex flex-col gap-4">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="h-8 animate-pulse motion-reduce:animate-none rounded-sm bg-(--primitive-opacity-white-alpha-6)" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <p className="text-body-text-b3-md text-grayscale-400">{t("empty")}</p>
        ) : (
          // `role="log"` belongs on the wrapper, not the list: an explicit role replaces the
          // element's implicit one, so a `<ul role="log">` stops being a list and orphans every
          // `<li>` inside it. The spec asks for both (§4.5), so they take one node each.
          // `p-3 -m-3`: see session-list — without it the scroll container clips the focus ring.
          // 12px rather than 4 because the highlight now reaches 8px past the text, and the ring
          // is drawn around the highlight: 8 for the highlight plus 4 for the ring.
          <div role="log" aria-live="polite" className="-m-3 flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
            {/* -mt-2 and gap-2 give back exactly what the row's own padding added, so the rows sit
                where they did: text at the same y, rule at the same y, same rhythm down the list. */}
            <ul className="-mt-2 flex flex-col gap-2">
              {events.map((event) => (
                <EventRow key={event.id} event={event} isNew={fresh.has(event.id)} />
              ))}
            </ul>
          </div>
        )}
      </section>

      <Link
        href="/demo"
        aria-disabled={demoDisabled}
        tabIndex={demoDisabled ? -1 : undefined}
        className={cn(
          "flex h-12 flex-none items-center justify-center gap-2 rounded-xl bg-blue-800 px-6 text-body-text-b2-md transition-colors hover:bg-blue-700",
          demoDisabled && "pointer-events-none opacity-50"
        )}
      >
        {tCta("demo")}
        <CtaChevronIcon className="h-6 w-5 flex-none" aria-hidden />
      </Link>
    </div>
  );
}
