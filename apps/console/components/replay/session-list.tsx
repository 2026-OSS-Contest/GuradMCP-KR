"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import type { SessionSummary, Verdict } from "@/lib/api/types";
import {
  VerdictAllowIcon,
  VerdictBlockIcon,
  VerdictRequireApprovalIcon,
  VerdictWarnIcon
} from "@/components/icons";
import { useReplay } from "./replay-provider";
import { hhmm } from "@/lib/time";
import { cn } from "@/lib/utils";

const VERDICT_ICON = {
  allow: VerdictAllowIcon,
  warn: VerdictWarnIcon,
  require_approval: VerdictRequireApprovalIcon,
  block: VerdictBlockIcon
} as const;

const VERDICT_TONE: Record<Verdict, string> = {
  allow: "bg-(--primitive-opacity-allow-alpha-10) text-green-500 shadow-[inset_0_0_0_1px_var(--primitive-opacity-allow-alpha-10)]",
  warn: "bg-(--primitive-opacity-warn-alpha-10) text-yellow-400 shadow-[inset_0_0_0_1px_var(--primitive-opacity-warn-alpha-10)]",
  require_approval:
    "bg-(--primitive-opacity-require-approval-alpha-25) text-violet-100 shadow-[inset_0_0_0_1px_var(--primitive-opacity-require-approval-alpha-25)]",
  block: "bg-(--primitive-opacity-block-alpha-10) text-red-300 shadow-[inset_0_0_0_1px_var(--primitive-opacity-block-alpha-10)]"
};

/** The small verdict-count pill the session card stacks (icon + count, no label). */
function VerdictCount({ verdict, count }: { verdict: Verdict; count: number }) {
  const Icon = VERDICT_ICON[verdict];
  return (
    <span className={cn("inline-flex flex-none items-center gap-1 rounded-full px-2 py-0.5 text-caption-text-c-md", VERDICT_TONE[verdict])}>
      <Icon className="h-5 w-4 flex-none" aria-hidden />
      {count}
    </span>
  );
}

function SessionCard({ session, selected, onSelect }: { session: SessionSummary; selected: boolean; onSelect: () => void }) {
  const t = useTranslations("replay.sessions");
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full flex-col rounded-lg p-3 text-left transition-colors",
        selected ? "bg-(--primitive-opacity-blue-alpha-25)" : "hover:bg-white/5"
      )}
    >
      <div className="flex items-center justify-between gap-4 pb-2 shadow-[inset_0_-1px_0_0_var(--primitive-opacity-white-alpha-10)]">
        <span className="flex min-w-0 items-center gap-4">
          <span className="truncate text-body-mono-b1-bd">#{session.id}</span>
          {session.live && (
            <span className="flex flex-none items-center gap-2 text-body-text-b3-bd text-red-300">
              <span className="size-2 flex-none rounded-full bg-red-300" aria-hidden />
              LIVE
            </span>
          )}
        </span>
        <time className="flex-none text-caption-text-c-rg text-(--primitive-opacity-white-alpha-75)" dateTime={session.startedAt}>
          {hhmm(session.startedAt)}
        </time>
      </div>

      <div className="flex items-center justify-between gap-4 pt-3">
        <span className="flex items-center gap-2">
          {session.verdicts.map((v) => (
            <VerdictCount key={v.verdict} verdict={v.verdict} count={v.count} />
          ))}
        </span>
        <span className="flex-none text-caption-text-c-rg text-(--primitive-opacity-white-alpha-75)">
          {t("eventCount", { count: session.eventCount })}
        </span>
      </div>
    </button>
  );
}

export function SessionList() {
  const t = useTranslations("replay.sessions");
  const { sessions, selectedSession, selectSession } = useReplay();
  const [query, setQuery] = useState("");

  const list = sessions.data?.sessions ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? list.filter((session) => session.id.toLowerCase().includes(q)) : list;
  }, [list, query]);

  return (
    <section className="flex w-66 flex-none flex-col gap-3 px-4 py-6 shadow-[inset_-1px_0_0_0_var(--primitive-color-grayscale-800)] min-[1920px]:w-[425px]">
      <h2 className="text-body-text-b3-md text-grayscale-300">{t("title")}</h2>

      <label className="flex items-center gap-2 rounded-lg bg-(--primitive-opacity-white-alpha-6) py-2 pr-2 pl-3">
        <Search className="size-6 flex-none text-(--primitive-opacity-white-alpha-50)" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-body-text-b3-md text-grayscale-white placeholder:text-(--primitive-opacity-white-alpha-50) focus:outline-none"
        />
      </label>

      {sessions.loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-[95px] animate-pulse motion-reduce:animate-none rounded-lg bg-(--primitive-opacity-white-alpha-6)" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-body-text-b3-md text-grayscale-400">{t("noResults")}</p>
      ) : (
        // `p-1 -m-1` leaves room for the 2px focus ring at its 2px offset without moving the list:
        // a scroll container with no padding clips the ring on all four sides (GMCP-90).
        <div className="-m-1 flex flex-col gap-3 overflow-y-auto p-1">
          {filtered.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              selected={session.id === selectedSession?.id}
              onSelect={() => selectSession(session.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
