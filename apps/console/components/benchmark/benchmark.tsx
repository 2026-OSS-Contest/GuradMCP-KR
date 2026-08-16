"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { getBenchmarkReport, getBenchmarkSamples } from "@/lib/api/client";
import { useResource } from "@/lib/api/use-resource";
import { RunList } from "./run-list";
import { ResultPanel } from "./result-panel";
import { RowDialog } from "./row-dialog";
import { toRows, useBenchmarkRun, type RunRow } from "./use-benchmark-run";
import { cn } from "@/lib/utils";

/** What re-runs the whole thing outside the console, printed on the result panel. */
const COMMAND = "npm run bench";

/**
 * SCR-601 Benchmark (GMCP-61): press run, watch every sample get checked, read what it came to.
 *
 * The measurement itself is not made here — `attack-lab/benchmark/run.ts` made it, and the two
 * endpoints hand back its report together with the samples it judged. So the left column is not
 * a progress bar standing in for work: it is the evidence, all 245 rows of it, and the panel on
 * the right is the summary a reader can check against them.
 */
export function Benchmark() {
  const t = useTranslations("benchmark");

  const report = useResource((signal) => getBenchmarkReport(signal));
  const samples = useResource((signal) => getBenchmarkSamples(signal));

  const rows = useMemo(
    () => (report.data && samples.data ? toRows(samples.data.samples, report.data) : []),
    [report.data, samples.data]
  );

  const { state, checked, start } = useBenchmarkRun(rows);
  /** The row the reader opened. Any row, run or not — the case is worth reading before it. */
  const [opened, setOpened] = useState<RunRow | null>(null);

  const loading = report.loading || samples.loading;
  const failed = Boolean(report.error || samples.error) && rows.length === 0;

  return (
    <div data-scr="SCR-601" className="flex min-h-0 flex-1 flex-col gap-4 px-8 py-6">
      <div className="flex flex-none items-center gap-3">
        <span className="flex min-w-0 flex-col">
          <h2 className="text-body-text-b1-bd text-grayscale-white">{t("title")}</h2>
          <span className="text-caption-text-c-rg text-(--primitive-opacity-white-alpha-50)">
            {t("subtitle", { count: rows.length })}
          </span>
        </span>
        <button
          type="button"
          onClick={start}
          // While it spins the button has no text of its own, so the name is carried here.
          aria-label={t(state === "done" ? "runAgain" : "run")}
          disabled={loading || rows.length === 0 || state === "running"}
          className={cn(
            // Hover goes darker rather than lighter: white on blue-700 is 4.18:1, under the
            // 4.5:1 the project holds itself to (기획서 NFR-08). blue-800 is 6.5:1, blue-900 11:1.
            "ml-auto flex h-10 flex-none items-center justify-center rounded-xl bg-blue-800 px-5 text-body-text-b2-md text-grayscale-white transition-colors hover:bg-blue-900",
            (loading || rows.length === 0 || state === "running") && "cursor-not-allowed opacity-50"
          )}
        >
          {loading || state === "running" ? (
            <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            t(state === "done" ? "runAgain" : "run")
          )}
        </button>
      </div>

      {failed ? (
        <p role="status" className="text-body-text-b3-md text-grayscale-400">
          {t("error")}
        </p>
      ) : (
        // The two never stack. Reading the result beside the rows it came from is the whole
        // composition, and a narrow window is exactly where a reader is most likely to lose
        // track of which list the numbers belong to — so both columns simply get narrower. The
        // panel keeps the 347px the other screens give their detail column until there is no
        // longer room, then shrinks with the window rather than dropping below it.
        <div className="flex min-h-0 flex-1 gap-4">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-(--primitive-radius-rounded-2xl) bg-grayscale-900 p-4">
            <RunList rows={rows} checked={checked} state={state} onSelect={setOpened} />
          </div>

          <div className="flex min-h-0 w-86.75 max-w-2/5 min-w-56 flex-col">
            {report.data && state === "done" ? (
              <ResultPanel report={report.data} checks={rows.length} command={COMMAND} />
            ) : (
              // Before the run there is nothing to report, and saying so is better than an
              // empty column the reader has to interpret. While the run is on, the same
              // `Proto/Shimmer` sweep SCR-201's panes use says the column is waiting on it.
              <p className="relative flex min-h-40 flex-1 items-center justify-center overflow-hidden rounded-(--primitive-radius-rounded-2xl) bg-(--primitive-opacity-white-alpha-6) p-6 text-center text-body-text-b3-md text-grayscale-400">
                {state === "running" && (
                  <span className="pane-shimmer motion-reduce:animate-none pointer-events-none absolute inset-0" aria-hidden />
                )}
                {t(state === "running" ? "measuring" : "idle")}
              </p>
            )}
          </div>
        </div>
      )}

      {opened && <RowDialog row={opened} onClose={() => setOpened(null)} />}
    </div>
  );
}
