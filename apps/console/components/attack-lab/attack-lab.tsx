"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";
import { getAttackScenarios, runAttackScenario } from "@/lib/api/client";
import type { AttackRun, AttackRunMode } from "@/lib/api/types";
import { useResource } from "@/lib/api/use-resource";
import { ScenarioPicker } from "./scenario-picker";
import { RunPane } from "./run-pane";
import { cn } from "@/lib/utils";

/** How fast the finished run plays back into its pane, one Tool Call Card at a time. */
const CARD_INTERVAL_MS = 420;

type Runs = Partial<Record<AttackRunMode, AttackRun>>;
type Visible = Record<AttackRunMode, number>;

const NO_CARDS: Visible = { unguarded: 0, guarded: 0 };

/**
 * SCR-201 Attack Lab (FR-UI-02, spec §5.2): pick a scenario, run it with the guard off and on,
 * and read the two runs side by side. Only one run is in flight at a time, so the panes can
 * never disagree about which scenario they are showing.
 */
export function AttackLab() {
  const t = useTranslations("attackLab");

  const scenarios = useResource((signal) => getAttackScenarios(signal));
  const list = scenarios.data?.scenarios ?? [];

  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [runs, setRuns] = useState<Runs>({});
  const [visible, setVisible] = useState<Visible>(NO_CARDS);
  const [running, setRunning] = useState<AttackRunMode | null>(null);
  const [failed, setFailed] = useState(false);

  // Settle on the first runnable scenario once the catalogue loads.
  const selected = list.find((scenario) => scenario.id === selectedId) ?? list.find((scenario) => scenario.available);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    // A new scenario invalidates both panes — they only ever show one scenario's runs.
    setRuns({});
    setVisible(NO_CARDS);
    setFailed(false);
  }, []);

  const start = async (mode: AttackRunMode) => {
    if (!selected || running) return;
    setRunning(mode);
    setFailed(false);
    setRuns((previous) => ({ ...previous, [mode]: undefined }));
    setVisible((previous) => ({ ...previous, [mode]: 0 }));
    try {
      const run = await runAttackScenario(selected.id, mode);
      setRuns((previous) => ({ ...previous, [mode]: run }));
    } catch {
      setFailed(true);
    } finally {
      setRunning(null);
    }
  };

  const pending = (["unguarded", "guarded"] as const).find((mode) => {
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

  return (
    <div data-scr="SCR-201" className="flex min-h-0 flex-1 flex-col gap-4 px-8 py-6">
      <div className="flex flex-none flex-wrap items-center gap-3">
        <ScenarioPicker scenarios={list} selected={selected} onSelect={select} disabled={busy} />
        {(["unguarded", "guarded"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => void start(mode)}
            // Only one run at a time (spec §5.2 no.2), so the other button locks while it plays.
            disabled={busy || !selected}
            className={cn(
              "flex h-11 flex-none items-center rounded-lg px-5 text-body-text-b2-md text-grayscale-white transition-colors",
              mode === "guarded" ? "bg-blue-800 hover:bg-blue-700" : "bg-grayscale-800 hover:bg-grayscale-700",
              (busy || !selected) && "cursor-not-allowed opacity-50"
            )}
          >
            {running === mode ? t("running") : t(mode === "guarded" ? "runGuarded" : "runUnguarded")}
          </button>
        ))}
      </div>

      {/* Sandbox notice (spec §5.2): the run never touches a real upstream. */}
      <p className="flex flex-none items-center gap-2 rounded-lg bg-(--primitive-opacity-warn-alpha-10) px-3 py-2 text-caption-text-c-rg text-yellow-100">
        <ShieldAlert className="size-4 flex-none" aria-hidden />
        {t("sandboxNotice")}
      </p>

      {failed && <p className="flex-none text-body-text-b3-md text-grayscale-400">{t("runError")}</p>}

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <RunPane mode="unguarded" run={runs.unguarded} visible={visible.unguarded} running={running === "unguarded"} />
        <RunPane mode="guarded" run={runs.guarded} visible={visible.guarded} running={running === "guarded"} />
      </div>
    </div>
  );
}
