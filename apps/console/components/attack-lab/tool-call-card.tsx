"use client";

import { useTranslations } from "next-intl";
import type { ToolCallCard as ToolCall } from "@/lib/api/types";
import { VerdictBadge } from "@/components/verdict-badge";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

function hhmmss(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * One Tool Call Card in a run pane (spec §5.2 no.3): the call, how the gateway ruled on it, and
 * — when the guard is applied — why, with the deciding policy.
 */
export function ToolCallCard({ call }: { call: ToolCall }) {
  const t = useTranslations("attackLab");

  return (
    <li
      // Cards arrive one at a time as the run plays out, so each fades in as it lands.
      className={cn(
        "flex flex-col gap-2 rounded-lg bg-grayscale-900 p-3 event-tint motion-reduce:animate-none",
        call.verdict === "block" && "shadow-[inset_0_0_0_1px_var(--primitive-opacity-block-alpha-10)]"
      )}
    >
      <div className="flex items-center gap-2">
        <VerdictBadge verdict={call.verdict} size="sm" />
        <span className="min-w-0 flex-1 truncate font-mono text-body-mono-b2-rg text-grayscale-white">
          {call.tool}
          {call.target && <span className="text-(--primitive-opacity-white-alpha-75)">({call.target})</span>}
        </span>
        <time className="flex-none text-caption-text-c-rg text-(--primitive-opacity-white-alpha-75)" dateTime={call.at}>
          {hhmmss(call.at)}
        </time>
      </div>

      {call.reason && <p className="text-body-text-b3-md text-grayscale-300">{call.reason}</p>}

      {call.policy && (
        <span className="flex items-center gap-2">
          <span className="flex-none text-caption-text-c-rg text-grayscale-400">{t("decidedBy")}</span>
          <Tag className="text-caption-mono-c-rg">{call.policy}</Tag>
        </span>
      )}
    </li>
  );
}
