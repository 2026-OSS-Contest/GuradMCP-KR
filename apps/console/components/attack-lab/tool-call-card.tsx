"use client";

import { useTranslations } from "next-intl";
import type { ToolCallCard as ToolCall, Verdict } from "@/lib/api/types";
import { VerdictBadge } from "@/components/verdict-badge";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

/** The caret the design puts before every call name. */
const Caret = () => <span className="flex-none text-grayscale-300">▶</span>;

/**
 * Only a ruling the gateway acted on is stamped, and the design draws just these two 전각 인장.
 * Straight from the design export — the grain is baked into the artwork.
 */
const SEALS: Partial<Record<Verdict, string>> = {
  block: "/seal/block.png",
  require_approval: "/seal/require-approval.png"
};

/**
 * One Tool Call Card in a run pane (spec §5.2 no.3). Three shapes: a call that ran (with the
 * payload it exposed), a call the gateway ruled on, and one the chain never reached.
 */
export function ToolCallCard({ call }: { call: ToolCall }) {
  const t = useTranslations("attackLab");

  // A call the chain never reached — drawn dashed and dimmed, with the reason inline.
  if (call.skippedReason) {
    return (
      <li className="flex items-center gap-2 rounded-lg border border-dashed border-(--primitive-opacity-white-alpha-25) px-3 py-2 opacity-50">
        <Caret />
        <span className="flex-none font-mono text-body-mono-b2-rg text-grayscale-300">{call.tool}</span>
        <span className="min-w-0 text-caption-text-c-rg text-grayscale-400">· {call.skippedReason}</span>
      </li>
    );
  }

  const blocked = call.verdict === "block";
  const seal = call.verdict ? SEALS[call.verdict] : undefined;

  return (
    <li
      className={cn(
        "relative flex flex-col gap-2 rounded-lg bg-(--primitive-opacity-white-alpha-6) p-3",
        // The blocked card carries the verdict's tint, which is what the eye lands on first.
        blocked && "bg-(--primitive-opacity-block-alpha-6) shadow-[inset_0_0_0_1px_var(--primitive-opacity-block-alpha-10)]",
        // Keep the copy clear of the seal, which is absolutely placed over the card's right side.
        seal && "pr-16"
      )}
    >
      {/* Stamped over the card the gateway ruled against. Cards arrive one at a time, so only
          one seal is ever landing at once. */}
      {seal && (
        <img
          src={seal}
          alt=""
          // Anchored below the title row so the call's timestamp stays readable beside it.
          className="verdict-seal motion-reduce:animate-none pointer-events-none absolute right-3 bottom-2 size-12"
          data-testid={`seal-${call.verdict}`}
          aria-hidden
        />
      )}
      <div className="flex items-start gap-2">
        <Caret />
        <span className="min-w-0 flex-1 font-mono text-body-mono-b2-rg break-all text-grayscale-white">
          {call.tool}
          {call.args && <span className="text-(--primitive-opacity-white-alpha-75)"> ({call.args})</span>}
        </span>
        <span className="flex-none text-caption-text-c-rg text-(--primitive-opacity-white-alpha-50)">{call.at}</span>
      </div>

      {/* Guarded: the verdict, the policy that decided it and the risk score. */}
      {call.verdict && (
        <div className="flex flex-wrap items-center gap-2">
          <VerdictBadge verdict={call.verdict} size="sm" />
          {call.policy && <Tag className="text-caption-mono-c-rg">{call.policy}</Tag>}
          {call.riskScore !== undefined && (
            <span className="flex items-center gap-1 text-body-text-b3-md text-grayscale-300">
              {t("riskScore")}
              <span className={cn(blocked ? "text-verdict-block" : "text-grayscale-white")}>{call.riskScore}</span>
            </span>
          )}
        </div>
      )}

      {/* Unguarded: what the call did, then what it exposed. */}
      {call.note && <p className="text-body-text-b3-md text-grayscale-300">{call.note}</p>}

      {call.payload && call.payload.length > 0 && (
        <div className="rounded-lg bg-(--primitive-opacity-black-alpha-75) p-3">
          <div className="flex flex-col gap-1 font-mono text-caption-mono-c-rg">
            {call.payload.map((line) => (
              <div key={line.key} className="flex flex-wrap gap-x-2 break-all">
                <span className="text-grayscale-300">{line.key} =</span>
                <span className={cn(line.secret ? "text-verdict-block underline" : "text-grayscale-200")}>
                  {line.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}
