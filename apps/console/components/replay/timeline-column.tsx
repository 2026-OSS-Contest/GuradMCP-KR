"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Pause } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import type { TimelineEvent, TimelineNodeType } from "@/lib/api/types";
import { VerdictBadge } from "@/components/verdict-badge";
import { useReplay } from "./replay-provider";
import {
  NodeAgentIcon,
  NodeResultIcon,
  NodeToolIcon,
  NodeUserIcon,
  NodeVerdictIcon,
  PlayControlIcon,
  RewindControlIcon,
  ShiftKeyIcon
} from "./timeline-icons";
import { cn } from "@/lib/utils";

/** Base tick; the speed control divides it (1x = 1200ms, 2x = 600ms, 4x = 300ms). */
const TICK_MS = 1200;
const SPEEDS = [1, 2, 4] as const;

const MARKER: Record<TimelineNodeType, ComponentType<SVGProps<SVGSVGElement>>> = {
  user: NodeUserIcon,
  agent: NodeAgentIcon,
  tool_call: NodeToolIcon,
  verdict: NodeVerdictIcon,
  result: NodeResultIcon
};

const LABEL_TONE: Partial<Record<TimelineNodeType, string>> = {
  user: "text-(--primitive-opacity-white-alpha-75)",
  // blue-600, not blue-700: on the timeline's `bg-grayscale-900` the darker step measured
  // 3.64:1, under the 4.5:1 AA floor (NFR-08).
  agent: "text-blue-600"
};

function hhmmss(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** One node on the Timeline Rail (spec §5.3 no.3). Mono title for tool/result, verdict shows tags. */
function NodeRow({
  event,
  selected,
  onSelect,
  register
}: {
  event: TimelineEvent;
  selected: boolean;
  onSelect: () => void;
  register: (el: HTMLButtonElement | null) => void;
}) {
  const t = useTranslations("replay.timeline");
  const Marker = MARKER[event.type];
  const mono = event.type === "tool_call" || event.type === "result";

  return (
    <button
      ref={register}
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-start gap-4 rounded-lg px-3 py-2 text-left transition-colors",
        event.verdict === "block" && "bg-(--primitive-opacity-block-alpha-6)",
        selected && "shadow-[inset_0_0_0_1px_var(--primitive-opacity-white-alpha-25)]"
      )}
    >
      <Marker className="size-10 flex-none" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {event.type === "verdict" ? (
          <span className="flex flex-wrap items-center gap-2">
            <VerdictBadge verdict={event.verdict ?? "allow"} size="md" />
            {event.policy && (
              <span className="max-w-full truncate rounded-[4px] bg-(--primitive-opacity-white-alpha-10) px-2 py-1 text-body-text-b3-md text-grayscale-white shadow-[inset_0_0_0_1px_var(--primitive-opacity-white-alpha-10)]">
                {event.policy}
              </span>
            )}
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            {LABEL_TONE[event.type] && (
              <span className={cn("flex-none text-body-text-b3-md", LABEL_TONE[event.type])}>
                {t(`node.${event.type}`)}
              </span>
            )}
            <span className={cn("min-w-0 break-words text-grayscale-white", mono ? "font-mono text-body-mono-b1-rg" : "text-body-text-b1-md")}>
              {event.title}
            </span>
            {/* Agent nodes point from their reasoning to the resulting decision (spec §5.3 rail). */}
            {event.type === "agent" && event.subtitle && (
              <ChevronRight className="size-6 flex-none text-(--primitive-opacity-white-alpha-50)" aria-hidden />
            )}
            {event.subtitle && <span className="break-words text-body-text-b1-md text-grayscale-white">{event.subtitle}</span>}
          </span>
        )}
        <time className="text-caption-text-c-rg text-(--primitive-opacity-white-alpha-75)" dateTime={event.at}>
          {hhmmss(event.at)}
        </time>
      </span>
    </button>
  );
}

export function TimelineColumn() {
  const t = useTranslations("replay.timeline");
  const { events, selectedEventId, selectEvent, live, timeline } = useReplay();

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  const index = events.findIndex((event) => event.id === selectedEventId);

  const step = useCallback(
    (delta: number) => {
      if (!events.length) return;
      const next = Math.min(events.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta));
      selectEvent(events[next].id);
    },
    [events, index, selectEvent]
  );

  const jumpToNextVerdict = useCallback(() => {
    const from = index < 0 ? -1 : index;
    const next = events.findIndex((event, i) => i > from && event.type === "verdict");
    if (next >= 0) selectEvent(events[next].id);
  }, [events, index, selectEvent]);

  // Playback: advance one node per tick until the last, then stop (spec §5.3 no.2).
  useEffect(() => {
    if (!playing) return;
    if (index >= events.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => step(1), TICK_MS / speed);
    return () => clearTimeout(timer);
  }, [playing, index, events.length, speed, step]);

  // Keyboard shortcuts (spec §4.4): Space play/pause, ↑↓ prev/next, Shift+B next verdict.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (event.key === " ") {
        event.preventDefault();
        setPlaying((previous) => !previous);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        step(1);
      } else if (event.shiftKey && (event.key === "B" || event.key === "b")) {
        event.preventDefault();
        jumpToNextVerdict();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, jumpToNextVerdict]);

  // Keep the selected node in view — the playhead follows playback and a live tail (spec §5.3).
  useEffect(() => {
    if (selectedEventId) rowRefs.current.get(selectedEventId)?.scrollIntoView({ block: "nearest" });
  }, [selectedEventId]);

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-3 bg-grayscale-black px-4 py-6">
      <div className="flex items-center gap-3">
        <h2 className="flex-1 text-body-text-b3-md text-grayscale-300">{t("title")}</h2>
        {live && (
          <span className="flex flex-none items-center gap-2 text-body-text-b3-bd text-red-300">
            <span className="size-2 flex-none rounded-full bg-red-300" aria-hidden />
            LIVE
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="play-toggle"
          onClick={() => setPlaying((previous) => !previous)}
          aria-label={playing ? t("pause") : t("play")}
          aria-pressed={playing}
          // The primitive (12px), not Tailwind's `rounded-xl` (16px): PlayControlIcon paints its
          // own 12px rounded rect over the whole button, so at 16px the focus ring traced a
          // corner the eye never sees. Pause is a small glyph, which is why only play showed it.
          className="flex size-10 flex-none items-center justify-center rounded-(--primitive-radius-rounded-xl) bg-blue-800 transition-colors hover:bg-blue-700"
        >
          {playing ? <Pause className="size-5 fill-current" aria-hidden /> : <PlayControlIcon className="size-10" aria-hidden />}
        </button>
        <button
          type="button"
          onClick={() => events[0] && selectEvent(events[0].id)}
          aria-label={t("toStart")}
          // Same 12px primitive — RewindControlIcon paints its own rounded rect too.
          className="flex size-10 flex-none items-center justify-center rounded-(--primitive-radius-rounded-xl) bg-(--primitive-opacity-white-alpha-25) transition-colors hover:bg-white/30"
        >
          <RewindControlIcon className="size-10" aria-hidden />
        </button>

        <div className="flex flex-none items-center gap-1 rounded-xl bg-(--primitive-opacity-white-alpha-6) p-1">
          {SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSpeed(value)}
              aria-pressed={speed === value}
              className={cn(
                "flex h-8 items-center rounded-lg px-3 text-body-text-b2-md transition-colors",
                speed === value ? "bg-(--primitive-opacity-white-alpha-25) text-grayscale-white" : "text-(--primitive-opacity-white-alpha-50) hover:text-grayscale-white"
              )}
            >
              {value}x
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={jumpToNextVerdict}
          className="flex h-10 flex-none items-center gap-1 rounded-xl bg-(--primitive-opacity-white-alpha-25) px-4 text-body-text-b2-md text-grayscale-white transition-colors hover:bg-white/30"
        >
          {t("nextVerdict")}
          <span className="flex items-center rounded-lg bg-(--primitive-opacity-white-alpha-10) py-0.5 pr-1 pl-0.5">
            <ShiftKeyIcon className="h-6 w-5 flex-none" aria-hidden />B
          </span>
        </button>
      </div>

      {timeline.loading ? (
        <div className="flex flex-1 flex-col gap-3 rounded-lg bg-grayscale-900 p-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse motion-reduce:animate-none rounded-lg bg-(--primitive-opacity-white-alpha-6)" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg bg-grayscale-900 text-title-text-t2-bd text-grayscale-400">
          {t("empty")}
        </div>
      ) : (
        // See recent-events: `role="log"` on the list itself would strip its list semantics.
        <div
          role="log"
          aria-live={live ? "polite" : "off"}
          className="flex flex-1 flex-col overflow-y-auto rounded-lg bg-grayscale-900 p-2"
        >
          <ol className="flex flex-1 flex-col gap-3">
            {events.map((event) => (
              <li key={event.id}>
                <NodeRow
                  event={event}
                  selected={event.id === selectedEventId}
                  onSelect={() => selectEvent(event.id)}
                  register={(el) => {
                    if (el) rowRefs.current.set(event.id, el);
                    else rowRefs.current.delete(event.id);
                  }}
                />
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
