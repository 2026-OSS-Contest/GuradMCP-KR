"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { getSessions } from "@/lib/api/client";
import type { SessionSummary } from "@/lib/api/types";
import { useResource } from "@/lib/api/use-resource";
import { DropdownChevronIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/**
 * SCR-000 session selector (spec §4.1): the session the console is scoped to, and a dropdown to
 * switch. Selecting one opens it on the Replay screen (SCR-301), which is where a session's
 * events are read.
 *
 * The label follows the route when it names a session, so navigating to a replay deep link and
 * picking from here can never disagree; otherwise it settles on the live session.
 */
export function SessionPicker() {
  const t = useTranslations("shell");
  const router = useRouter();
  const params = useParams<{ sessionId?: string }>();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());

  const sessions = useResource((signal) => getSessions(signal));
  const list = sessions.data?.sessions ?? [];

  const routeId = typeof params?.sessionId === "string" ? decodeURIComponent(params.sessionId) : undefined;
  const selected: SessionSummary | undefined =
    list.find((session) => session.id === routeId) ?? list.find((session) => session.live) ?? list[0];

  const close = (returnFocus = false) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  // Dismiss on outside click or Escape, the same way the policy chip's popover does. Escape
  // returns focus to the trigger so keyboard users are not dropped at the top of the document.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Opening moves focus onto the current option, so the arrow keys have somewhere to start.
  useEffect(() => {
    if (!open || !selected) return;
    optionRefs.current.get(selected.id)?.focus();
  }, [open, selected]);

  const select = (id: string) => {
    setOpen(false);
    router.push(`/replay/${encodeURIComponent(id)}`);
  };

  /** Roving focus across the options (Enter and Space activate the button natively). */
  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key) || !list.length) return;
    event.preventDefault();
    const active = document.activeElement as HTMLElement | null;
    const index = list.findIndex((session) => optionRefs.current.get(session.id) === active);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? list.length - 1
          : event.key === "ArrowDown"
            ? Math.min(list.length - 1, index + 1)
            : Math.max(0, (index < 0 ? 0 : index) - 1);
    optionRefs.current.get(list[next].id)?.focus();
  };

  const failed = Boolean(sessions.error) && !sessions.data;

  return (
    <div ref={ref} className="relative flex-none">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          // inline-flex keeps the label on the status bar's baseline (see the chips above).
          "inline-flex h-8 items-center gap-2 rounded-sm bg-(--primitive-opacity-white-alpha-6) py-1 pr-1 pl-3 transition-colors hover:bg-white/10",
          open && "bg-white/10"
        )}
      >
        <span className="text-body-text-b3-md text-grayscale-200">{t("session")}</span>
        <span className="text-body-text-b3-md">{selected ? `#${selected.id}` : "—"}</span>
        <DropdownChevronIcon className={cn("size-6 flex-none transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div className="absolute top-full right-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg bg-grayscale-900 p-2 shadow-xl shadow-black/50 outline-1 -outline-offset-1 outline-grayscale-700">
          {failed ? (
            <p className="px-2 py-3 text-body-text-b3-md text-grayscale-400">{t("sessionError")}</p>
          ) : !sessions.data ? (
            <div className="flex flex-col gap-1" aria-hidden>
              {[0, 1, 2].map((index) => (
                <div key={index} className="h-11 animate-pulse motion-reduce:animate-none rounded-md bg-(--primitive-opacity-white-alpha-6)" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <p className="px-2 py-3 text-body-text-b3-md text-grayscale-400">{t("sessionEmpty")}</p>
          ) : (
            // The options are the listbox's own children — a ul/li in between would break the
            // ownership assistive technology reads positions from.
            <div role="listbox" aria-label={t("session")} onKeyDown={onListKeyDown} className="flex flex-col gap-1">
              {list.map((session) => {
                const current = session.id === selected?.id;
                return (
                  <button
                    key={session.id}
                    ref={(el) => {
                      if (el) optionRefs.current.set(session.id, el);
                      else optionRefs.current.delete(session.id);
                    }}
                    type="button"
                    role="option"
                    aria-selected={current}
                    tabIndex={current ? 0 : -1}
                    onClick={() => select(session.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-white/5",
                      current && "bg-(--primitive-opacity-white-alpha-10)"
                    )}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-mono text-caption-mono-c-rg text-grayscale-white">#{session.id}</span>
                        {session.live && (
                          <span className="flex flex-none items-center gap-1 text-caption-text-c-rg text-red-300">
                            <span className="size-1.5 flex-none rounded-full bg-red-300" aria-hidden />
                            LIVE
                          </span>
                        )}
                      </span>
                      <span className="text-caption-text-c-rg text-(--primitive-opacity-white-alpha-75)">
                        <time dateTime={session.startedAt}>{hhmm(session.startedAt)}</time>
                        {" · "}
                        {t("sessionEvents", { count: session.eventCount })}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
