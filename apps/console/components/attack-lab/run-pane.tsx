"use client";

import { useTranslations } from "next-intl";
import { Info, RotateCcw } from "lucide-react";
import type { AttackRun, AttackRunMode } from "@/lib/api/types";
import { LiveConsoleIcon } from "@/components/shell/nav-icons";
import { ToolCallCard } from "./tool-call-card";
import { cn } from "@/lib/utils";

/**
 * One half of the split result view (spec §5.2 no.3): the calls the scenario made with the guard
 * off or on. Idle until a run starts, then the cards arrive one at a time; a failed request
 * offers a retry in place.
 */
export function RunPane({
  mode,
  run,
  visible,
  running,
  failed,
  onRetry
}: {
  mode: AttackRunMode;
  run: AttackRun | undefined;
  /** How many of the run's calls have arrived so far. */
  visible: number;
  running: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations("attackLab");
  const guarded = mode === "guarded";
  const calls = run?.calls.slice(0, visible) ?? [];
  const started = running || Boolean(run) || failed;

  return (
    <section aria-label={t(guarded ? "paneGuarded" : "paneUnguarded")} className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <header className="flex flex-none items-center gap-2">
        <span
          className={cn("size-2 flex-none rounded-full", guarded ? "bg-verdict-allow" : "bg-verdict-block")}
          aria-hidden
        />
        <h3 className="flex-1 text-body-text-b2-md text-grayscale-white">
          {t(guarded ? "paneGuarded" : "paneUnguarded")}
        </h3>
        {/* Where the calls actually went — a dash until a run says. */}
        <span className="flex-none text-caption-text-c-rg text-(--primitive-opacity-white-alpha-50)">
          {started ? t(guarded ? "viaGuard" : "viaSandbox") : "–"}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col rounded-lg bg-grayscale-900 p-3">
        {failed ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-(--primitive-opacity-white-alpha-10)">
              <Info className="size-5 text-grayscale-300" aria-hidden />
            </span>
            <p className="text-body-text-b1-md text-grayscale-white">{t("runFailedTitle")}</p>
            <p className="text-body-text-b3-md whitespace-pre-line text-grayscale-400">{t("runFailedBody")}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-1 flex h-10 items-center gap-2 rounded-lg bg-blue-800 px-5 text-body-text-b2-md text-grayscale-white transition-colors hover:bg-blue-700"
            >
              <RotateCcw className="size-4" aria-hidden />
              {t("retry")}
            </button>
          </div>
        ) : !started ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-(--primitive-opacity-white-alpha-10)">
              <LiveConsoleIcon className="size-5 text-grayscale-300" aria-hidden />
            </span>
            <p className="text-body-text-b1-md text-grayscale-white">{t("paneIdle")}</p>
          </div>
        ) : (
          <ol role="log" aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {calls.map((call) => (
              <ToolCallCard key={call.id} call={call} />
            ))}
            {running && calls.length === 0 && (
              <li className="h-20 animate-pulse motion-reduce:animate-none rounded-lg bg-(--primitive-opacity-white-alpha-6)" />
            )}
          </ol>
        )}
      </div>
    </section>
  );
}
