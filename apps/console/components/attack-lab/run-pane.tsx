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
  queued,
  onRetry
}: {
  mode: AttackRunMode;
  run: AttackRun | undefined;
  /** How many of the run's calls have arrived so far. */
  visible: number;
  running: boolean;
  failed: boolean;
  /** Accepted by the control plane, but it has no runner to produce the calls. */
  queued: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations("attackLab");
  const guarded = mode === "guarded";
  const calls = run?.calls?.slice(0, visible) ?? [];
  const started = running || Boolean(run) || failed || queued;

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

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-grayscale-900 p-3">
        {/* `Proto/Shimmer`: the pane sweeps while its own run is still coming back. */}
        {running && (
          <span className="pane-shimmer motion-reduce:animate-none pointer-events-none absolute inset-0" aria-hidden />
        )}
        {queued ? (
          // Deliberately not the failure state: the request succeeded, and there is nothing to
          // retry. Naming the ticket keeps the reason findable instead of reading as a bug.
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-(--primitive-opacity-white-alpha-10)">
              <Info className="size-5 text-grayscale-300" aria-hidden />
            </span>
            <p className="text-body-text-b1-md text-grayscale-white">{t("runQueuedTitle")}</p>
            <p className="text-body-text-b3-md whitespace-pre-line text-grayscale-400">{t("runQueuedBody")}</p>
          </div>
        ) : failed ? (
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
            <p className="text-title-text-t2-bd text-grayscale-white">{t("paneIdle")}</p>
          </div>
        ) : (
          // See recent-events: `role="log"` on the list itself would strip its list semantics.
          // `p-1 -m-1`: see session-list — without it the scroll container clips the focus ring.
          <div role="log" aria-live="polite" className="-m-1 flex min-h-0 flex-1 flex-col overflow-y-auto p-1">
            <ol className="flex flex-col gap-2">
              {calls.map((call) => (
                <ToolCallCard key={call.id} call={call} />
              ))}
              {running && calls.length === 0 && (
                <li className="h-20 animate-pulse motion-reduce:animate-none rounded-lg bg-(--primitive-opacity-white-alpha-6)" />
              )}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
