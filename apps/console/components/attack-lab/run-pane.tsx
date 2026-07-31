"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { AttackRun, AttackRunMode } from "@/lib/api/types";
import { CtaChevronIcon } from "@/components/icons";
import { ToolCallCard } from "./tool-call-card";
import { cn } from "@/lib/utils";

/** The stamp a finished run leaves on its pane (spec §5.2 no.4). */
function VerdictSeal({ outcome }: { outcome: AttackRun["outcome"] }) {
  const t = useTranslations("attackLab");
  const blocked = outcome === "blocked";

  return (
    <span
      // Only ever one seal animates at a time, because only one run is in flight per page.
      className={cn(
        "verdict-seal motion-reduce:animate-none pointer-events-none absolute top-3 right-3 rounded-md px-3 py-1 text-body-text-b1-md",
        blocked
          ? "bg-(--primitive-opacity-allow-alpha-10) text-verdict-allow shadow-[inset_0_0_0_2px_currentColor]"
          : "bg-(--primitive-opacity-block-alpha-10) text-verdict-block shadow-[inset_0_0_0_2px_currentColor]"
      )}
    >
      {blocked ? t("sealBlocked") : t("sealLeaked")}
    </span>
  );
}

/** Result summary strip with the deep link into the recorded session (spec §5.2 no.5). */
function SummaryStrip({ run }: { run: AttackRun }) {
  const t = useTranslations("attackLab");

  return (
    <div className="flex flex-none items-center gap-3 rounded-lg bg-(--primitive-opacity-white-alpha-6) px-3 py-2">
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-caption-text-c-rg text-grayscale-300">
        <span>{t("summaryBlocked", { count: run.blocked })}</span>
        <span>{t("summaryMasked", { count: run.masked })}</span>
        <span>{t("summaryElapsed", { seconds: (run.elapsedMs / 1000).toFixed(1) })}</span>
      </span>
      <Link
        href={`/replay/${run.sessionId}`}
        className="inline-flex flex-none items-center gap-1 text-caption-text-c-rg text-blue-700 transition-opacity hover:opacity-80"
      >
        {t("openInReplay")}
        <CtaChevronIcon className="h-5 w-4 flex-none" aria-hidden />
      </Link>
    </div>
  );
}

/**
 * One half of the split result view (spec §5.2 no.3): the tool calls the scenario made with the
 * guard off or on. Calls appear as the run plays out, then the seal stamps the outcome.
 */
export function RunPane({
  mode,
  run,
  visible,
  running
}: {
  mode: AttackRunMode;
  run: AttackRun | undefined;
  /** How many of the run's calls have arrived so far. */
  visible: number;
  running: boolean;
}) {
  const t = useTranslations("attackLab");
  const guarded = mode === "guarded";
  const calls = run?.calls.slice(0, visible) ?? [];
  const done = Boolean(run) && visible >= (run?.calls.length ?? 0);

  return (
    <section
      aria-label={t(guarded ? "paneGuarded" : "paneUnguarded")}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col gap-3 rounded-lg bg-grayscale-950 p-4",
        guarded
          ? "shadow-[inset_0_0_0_1px_var(--primitive-opacity-allow-alpha-10)]"
          : "shadow-[inset_0_0_0_1px_var(--primitive-opacity-block-alpha-10)]"
      )}
    >
      <header className="flex flex-none flex-col gap-1">
        <h3 className={cn("text-body-text-b1-md", guarded ? "text-verdict-allow" : "text-verdict-block")}>
          {t(guarded ? "paneGuarded" : "paneUnguarded")}
        </h3>
        <p className="text-caption-text-c-rg text-grayscale-400">
          {t(guarded ? "paneGuardedHint" : "paneUnguardedHint")}
        </p>
      </header>

      {done && run && <VerdictSeal outcome={run.outcome} />}

      {!run && !running ? (
        <p className="flex flex-1 items-center justify-center text-body-text-b3-md text-grayscale-400">{t("paneIdle")}</p>
      ) : (
        <ol role="log" aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {calls.map((call) => (
            <ToolCallCard key={call.id} call={call} />
          ))}
          {running && calls.length === 0 && (
            <li className="h-16 animate-pulse motion-reduce:animate-none rounded-lg bg-(--primitive-opacity-white-alpha-6)" />
          )}
        </ol>
      )}

      {done && run && <SummaryStrip run={run} />}
    </section>
  );
}
