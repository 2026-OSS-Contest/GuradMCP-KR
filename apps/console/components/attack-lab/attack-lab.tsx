"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { getAttackScenarios, runAttackScenario } from "@/lib/api/client";
import type { AttackRun, AttackRunMode } from "@/lib/api/types";
import { useResource } from "@/lib/api/use-resource";
import { BannerInfoIcon } from "@/components/icons";
import { ScenarioPicker } from "./scenario-picker";
import { RunPane } from "./run-pane";
import { SummaryStrip } from "./summary-strip";
import { StreamTable } from "./stream-table";
import { cn } from "@/lib/utils";

/** How fast the finished run plays back into its pane, one Tool Call Card at a time. */
const CARD_INTERVAL_MS = 420;

const MODES = ["unguarded", "guarded"] as const;

type Runs = Partial<Record<AttackRunMode, AttackRun>>;
type PerMode<T> = Record<AttackRunMode, T>;

const ZEROED: PerMode<number> = { unguarded: 0, guarded: 0 };
const NOT_FAILED: PerMode<boolean> = { unguarded: false, guarded: false };

/**
 * SCR-201 Attack Lab (FR-UI-02, spec §5.2): pick a scenario, run it with the guard off and on,
 * and read the two runs side by side, with the gateway's own event feed underneath.
 */
export function AttackLab() {
  const t = useTranslations("attackLab");

  const scenarios = useResource((signal) => getAttackScenarios(signal));
  const list = scenarios.data?.scenarios ?? [];

  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [runs, setRuns] = useState<Runs>({});
  const [visible, setVisible] = useState<PerMode<number>>(ZEROED);
  const [failed, setFailed] = useState<PerMode<boolean>>(NOT_FAILED);
  const [running, setRunning] = useState<AttackRunMode | null>(null);
  /** Which run the summary strip and the stream table are reporting. */
  const [latest, setLatest] = useState<AttackRunMode | null>(null);

  // Nothing is selected until the operator chooses — the design opens on the 대기 state.
  const selected = list.find((scenario) => scenario.id === selectedId);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    // A new scenario invalidates everything below it — the panes only show one scenario's runs.
    setRuns({});
    setVisible(ZEROED);
    setFailed(NOT_FAILED);
    setLatest(null);
  }, []);

  const start = useCallback(
    async (mode: AttackRunMode, scenarioId: string) => {
      setRunning(mode);
      setFailed((previous) => ({ ...previous, [mode]: false }));
      setRuns((previous) => ({ ...previous, [mode]: undefined }));
      setVisible((previous) => ({ ...previous, [mode]: 0 }));
      try {
        const run = await runAttackScenario(scenarioId, mode);
        setRuns((previous) => ({ ...previous, [mode]: run }));
        setLatest(mode);
      } catch {
        setFailed((previous) => ({ ...previous, [mode]: true }));
      } finally {
        setRunning(null);
      }
    },
    []
  );

  const pending = MODES.find((mode) => {
    const run = runs[mode];
    return run && visible[mode] < run.calls.length;
  });

  // Play the finished run back card by card, which is what makes the pane read as a stream. The
  // shown count is a dependency too: `pending` alone stays equal between cards of the same run.
  const shown = pending ? visible[pending] : -1;
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(
      () => setVisible((previous) => ({ ...previous, [pending]: previous[pending] + 1 })),
      CARD_INTERVAL_MS
    );
    return () => clearTimeout(timer);
  }, [pending, shown]);

  // One run at a time (spec §5.2 no.2) — held through the playback too, so a second run cannot
  // start while a pane is still filling and leave the two streams interleaving.
  const busy = running !== null || pending !== undefined;
  const latestRun = latest ? runs[latest] : undefined;

  return (
    <div data-scr="SCR-201" className="flex flex-1 flex-col gap-4 px-8 py-6">
      {/* One row down to 1024, the narrowest frame the design draws. */}
      <div className="flex flex-none items-center gap-3">
        <span className="flex-none text-body-text-b2-md text-grayscale-300">{t("scenario")}</span>
        <ScenarioPicker scenarios={list} selected={selected} onSelect={select} disabled={busy} />
        {/* Run controls sit at the far right of the row (spec §5.2). */}
        <span className="ml-auto flex flex-none items-center gap-3">
          {MODES.map((mode) => {
            const guarded = mode === "guarded";
            const disabled = busy || !selected;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => selected && void start(mode, selected.id)}
                disabled={disabled}
                aria-label={t(guarded ? "runGuarded" : "runUnguarded")}
                className={cn(
                  "flex h-10 flex-none items-center justify-center rounded-xl px-5 text-body-text-b2-md text-grayscale-white transition-colors",
                  guarded ? "bg-blue-800 hover:bg-blue-700" : "bg-grayscale-800 hover:bg-grayscale-700",
                  disabled && "cursor-not-allowed opacity-50"
                )}
              >
                {running === mode ? (
                  <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
                ) : (
                  t(guarded ? "runGuarded" : "runUnguarded")
                )}
              </button>
            );
          })}
        </span>
      </div>

      {/* Sandbox notice (spec §5.2): the unguarded run never touches anything real. */}
      <p className="flex flex-none items-center gap-2 rounded-lg bg-(--primitive-opacity-blue-alpha-25) px-4 py-3 text-body-text-b3-md text-grayscale-200">
        <BannerInfoIcon className="size-4 flex-none" aria-hidden />
        {t("sandboxNotice")}
      </p>

      <div className="flex min-h-96 flex-1 flex-col gap-4 md:flex-row">
        {MODES.map((mode) => (
          <RunPane
            key={mode}
            mode={mode}
            run={runs[mode]}
            visible={visible[mode]}
            running={running === mode}
            failed={failed[mode]}
            onRetry={() => selected && void start(mode, selected.id)}
          />
        ))}
      </div>

      <SummaryStrip summary={latestRun?.summary} sessionId={latestRun?.sessionId} />
      <StreamTable rows={latestRun?.stream ?? []} />
    </div>
  );
}
