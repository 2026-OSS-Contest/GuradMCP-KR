"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { RunSummary, Verdict } from "@/lib/api/types";
import {
  CtaChevronIcon,
  VerdictAllowIcon,
  VerdictBlockIcon,
  VerdictRequireApprovalIcon,
  VerdictWarnIcon
} from "@/components/icons";
import { cn } from "@/lib/utils";

const ITEMS: { verdict: Verdict; key: keyof RunSummary; Icon: typeof VerdictAllowIcon; tone: string }[] = [
  { verdict: "block", key: "block", Icon: VerdictBlockIcon, tone: "text-verdict-block" },
  { verdict: "warn", key: "warn", Icon: VerdictWarnIcon, tone: "text-verdict-warn" },
  { verdict: "require_approval", key: "require_approval", Icon: VerdictRequireApprovalIcon, tone: "text-violet-100" },
  { verdict: "allow", key: "allow", Icon: VerdictAllowIcon, tone: "text-verdict-allow" }
];

const LABEL: Record<Verdict, string> = {
  block: "block",
  warn: "warn",
  require_approval: "requireApproval",
  allow: "allow"
};

/**
 * Result summary for the run just played, shared by both panes (spec §5.2 no.4). Counts read as
 * a dash until a run has produced any, and the Replay link only resolves once one has.
 */
export function SummaryStrip({ summary, sessionId }: { summary: RunSummary | undefined; sessionId: string | undefined }) {
  const t = useTranslations("attackLab");
  const tVerdict = useTranslations("verdict");

  return (
    <div className="flex flex-none flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-grayscale-900 px-4 py-3">
      <span className="flex-none text-body-text-b3-md text-grayscale-300">{t("resultSummary")}</span>

      {ITEMS.map(({ verdict, key, Icon, tone }) => (
        <span key={key} className="flex flex-none items-center gap-2 text-body-text-b3-md text-(--primitive-opacity-white-alpha-50)">
          <Icon className={cn("h-5 w-4 flex-none", tone)} aria-hidden />
          {tVerdict(LABEL[verdict])}
          <span className="text-grayscale-white">{summary ? summary[key] : "–"}</span>
        </span>
      ))}

      <span className="ml-auto flex-none">
        {sessionId ? (
          <Link
            href={`/replay/${sessionId}`}
            className="inline-flex h-8 items-center gap-1 rounded-lg bg-(--primitive-opacity-white-alpha-25) px-4 text-body-text-b3-md text-grayscale-white transition-colors hover:bg-white/30"
          >
            {t("openInReplay")}
            <CtaChevronIcon className="h-5 w-4 flex-none" aria-hidden />
          </Link>
        ) : (
          <span
            aria-disabled
            className="inline-flex h-8 cursor-not-allowed items-center gap-1 rounded-lg bg-(--primitive-opacity-white-alpha-6) px-4 text-body-text-b3-md text-grayscale-400 opacity-50"
          >
            {t("openInReplay")}
            <CtaChevronIcon className="h-5 w-4 flex-none" aria-hidden />
          </span>
        )}
      </span>
    </div>
  );
}
