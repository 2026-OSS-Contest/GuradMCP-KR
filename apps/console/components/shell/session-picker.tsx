"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { getSessions } from "@/lib/api/client";
import type { SessionSummary } from "@/lib/api/types";
import { useResource } from "@/lib/api/use-resource";
import { DropdownChevronIcon } from "@/components/icons";
import { hhmm } from "@/lib/time";
import { cn } from "@/lib/utils";

const LIST_ID = "session-picker-list";

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
  const optionRefs = useRef<Map<string, HTMLButtonElement>>(null);
  optionRefs.current ??= new Map();
  /** Which option opening should land on — ArrowUp enters the list from the bottom (APG). */
  const openTo = useRef<"selected" | "last">("selected");

  // Re-fetched every time the menu opens, which is the recovery the empty and unreachable copy
  // promises: reopening after the gateway comes back asks again instead of showing stale text.
  const [opened, setOpened] = useState(0);
  const sessions = useResource((signal) => getSessions(signal), { key: String(opened) });
  const list = sessions.data?.sessions ?? [];

  // `useParams` already decodes the segment; decoding again corrupts an id containing a "%".
  const routeId = typeof params?.sessionId === "string" ? params.sessionId : undefined;
  const selected: SessionSummary | undefined =
    list.find((session) => session.id === routeId) ?? list.find((session) => session.live) ?? list[0];

  const show = (to: "selected" | "last" = "selected") => {
    openTo.current = to;
    setOpened((count) => count + 1);
    setOpen(true);
  };

  const close = (returnFocus = false) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  // Dismiss on Escape, the same way the policy chip's popover does; focus returns to the trigger
  // so keyboard users are not dropped at the top of the document.
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

  // Opening moves focus into the list, so the arrow keys have somewhere to start.
  useEffect(() => {
    if (!open || !list.length) return;
    const target = openTo.current === "last" ? list[list.length - 1] : (selected ?? list[0]);
    optionRefs.current?.get(target.id)?.focus();
  }, [open, list, selected]);

  const select = (id: string) => {
    setOpen(false);
    router.push(`/replay/${encodeURIComponent(id)}`);
    // Focus is deliberately not restored to the trigger here. Selecting navigates, and the App
    // Router resets focus to the document on a route change so the next screen is read from its
    // start — measured: focus lands on the trigger, then the router moves it the moment the URL
    // changes. Escape does restore it, because dismissing without navigating leaves the operator
    // where they were.
  };

  /** Roving focus across the options (Enter and Space activate the button natively). */
  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key) || !list.length) return;
    event.preventDefault();
    const active = document.activeElement as HTMLElement | null;
    const index = list.findIndex((session) => optionRefs.current?.get(session.id) === active);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? list.length - 1
          : event.key === "ArrowDown"
            ? Math.min(list.length - 1, index + 1)
            : Math.max(0, (index < 0 ? 0 : index) - 1);
    optionRefs.current?.get(list[next].id)?.focus();
  };

  const failed = Boolean(sessions.error) && !sessions.data;
  const hasList = Boolean(sessions.data) && list.length > 0;

  return (
    <div
      ref={ref}
      // Tab out of the popover dismisses it too: outside click, Escape and focus leave are the
      // three ways a popover is expected to close.
      onBlur={(event) => {
        if (!open) return;
        if (!event.relatedTarget || !ref.current?.contains(event.relatedTarget as Node)) setOpen(false);
      }}
      className="relative flex-none"
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
          event.preventDefault();
          show(event.key === "ArrowUp" ? "last" : "selected");
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        // Only claim to control the listbox while one is actually rendered — the empty and error
        // states put a status message in the popover instead.
        aria-controls={open && hasList ? LIST_ID : undefined}
        className={cn(
          // inline-flex keeps the label on the status bar's baseline (see the chips above).
          // The design fixes the trigger at 180px and lets the session id fill it, so the chevron
          // sits at the right edge rather than drifting with the id's length.
          "inline-flex h-8 w-45 items-center gap-2 rounded-lg bg-(--primitive-opacity-white-alpha-6) py-1 pr-1 pl-3 transition-colors hover:bg-white/10",
          open && "bg-white/10"
        )}
      >
        <span className="text-body-text-b3-md text-grayscale-200">{t("session")}</span>
        <span className="min-w-0 flex-1 truncate text-left text-body-text-b3-md">{selected ? `#${selected.id}` : "—"}</span>
        <DropdownChevronIcon className={cn("size-6 flex-none transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div className="absolute top-full right-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg bg-grayscale-900 p-2 shadow-xl shadow-black/50 outline-1 -outline-offset-1 outline-grayscale-700">
          {failed ? (
            <p role="status" className="px-2 py-3 text-body-text-b3-md text-grayscale-400">
              {t("sessionError")}
            </p>
          ) : !sessions.data ? (
            <div className="flex flex-col gap-1" aria-hidden>
              {[0, 1, 2].map((index) => (
                <div key={index} className="h-11 animate-pulse motion-reduce:animate-none rounded-md bg-(--primitive-opacity-white-alpha-6)" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <p role="status" className="px-2 py-3 text-body-text-b3-md text-grayscale-400">
              {t("sessionEmpty")}
            </p>
          ) : (
            // The options are the listbox's own children — a ul/li in between would break the
            // ownership assistive technology reads positions from.
            <div
              id={LIST_ID}
              role="listbox"
              aria-label={t("session")}
              onKeyDown={onListKeyDown}
              className="flex flex-col gap-1"
            >
              {list.map((session) => {
                const current = session.id === selected?.id;
                return (
                  <button
                    key={session.id}
                    ref={(el) => {
                      if (el) optionRefs.current?.set(session.id, el);
                      else optionRefs.current?.delete(session.id);
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
