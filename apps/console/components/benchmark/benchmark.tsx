"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { getBenchmarkReport, getBenchmarkSamples } from "@/lib/api/client";
import { useResource } from "@/lib/api/use-resource";
import { RunList } from "./run-list";
import { ResultPanel } from "./result-panel";
import { RowDialog } from "./row-dialog";
import { EmptyTargetIcon } from "./icons";
import { toRows, useBenchmarkRun, type RunRow } from "./use-benchmark-run";
import { cn } from "@/lib/utils";

/** What re-runs the whole thing outside the console, printed on the result panel. */
const COMMAND = "npm run bench";

/**
 * The right column before there is anything to report (`Empty` in the frames): the rings disc
 * and one line, centred in a 900 card. The 실행완료 frame swaps this card for the transparent
 * detail column.
 */
function EmptyColumn() {
  const t = useTranslations("benchmark");
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 rounded-(--primitive-radius-rounded-xl) bg-grayscale-900 px-8 py-6">
      <div className="flex flex-col items-center gap-4">
        <EmptyTargetIcon className="size-10" aria-hidden />
        <p className="text-center text-title-text-t2-bd whitespace-pre-line text-grayscale-white">{t("idle")}</p>
      </div>
    </div>
  );
}

/**
 * SCR-601 Benchmark (GMCP-61): press run, watch every case get checked, read what it came to.
 *
 * The measurement itself is not made here — `attack-lab/benchmark/run.ts` made it, and the two
 * endpoints hand back its report together with the samples it judged. The left column is the
 * evidence, all 245 rows of it, and the panel on the right is the summary a reader can check
 * against them.
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

  // 실행중-재실행 frame: a re-run keeps the previous report on screen while the cascade
  // replays; the first run has nothing to keep, so the report only lands when it finishes.
  const [ranOnce, setRanOnce] = useState(false);
  useEffect(() => {
    if (state === "done") setRanOnce(true);
  }, [state]);
  const showReport = Boolean(report.data) && (state === "done" || (state === "running" && ranOnce));

  return (
    <div data-scr="SCR-601" className="flex min-h-0 flex-1 flex-col gap-4 bg-grayscale-black px-4 py-6">
      <div className="flex flex-none items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-body-text-b1-md text-grayscale-300">{t("title")}</h2>
          {/* «샘플 245건 | 데이터셋 · 공격 시나리오 · 정책 픽스처» — the dots are the frame's
              own 2px discs, not typed characters. */}
          <span className="flex items-center gap-2 text-body-text-b3-md text-grayscale-400">
            <span>{t("subtitleCount", { count: rows.length })}</span>
            <span aria-hidden>|</span>
            <span>{t("legend.datasets")}</span>
            <Dot />
            <span>{t("legend.scenarios")}</span>
            <Dot />
            <span>{t("legend.fixtures")}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={start}
          // While it spins the button has no text of its own, so the name is carried here.
          aria-label={t(state === "done" ? "runAgain" : "run")}
          disabled={loading || rows.length === 0 || state === "running"}
          className={cn(
            // Hover darkens rather than lightens: white on blue-700 is 4.18:1, under the 4.5:1
            // the project holds itself to (기획서 NFR-08). blue-800 is 6.5:1, blue-900 11:1.
            "flex h-10 flex-none items-center justify-center rounded-(--primitive-radius-rounded-xl) bg-blue-800 px-4 text-body-text-b2-md text-grayscale-white transition-colors hover:bg-blue-900",
            (loading || rows.length === 0 || state === "running") && "cursor-not-allowed opacity-50"
          )}
        >
          {state === "running" ? (
            <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            t(state === "done" ? "runAgain" : "run")
          )}
        </button>
      </div>

      {/* Two columns at every width, the right one roughly a third (364/1008 · 560/1648 ·
          274/752 across the frames' three widths). They never stack — the result is read
          against the rows it came from. */}
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-(--primitive-radius-rounded-xl) bg-grayscale-900">
          {loading || failed ? (
            // The 두-응답-도착-전 / 응답-실패 frames put the message inside the list card, with
            // the shimmer sweeping the card only while it is genuinely waiting.
            <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
              <p role={failed ? "status" : undefined} className="text-body-text-b2-md text-grayscale-white">
                {t(failed ? "error" : "loadingList")}
              </p>
              {loading && (
                <span className="pane-shimmer motion-reduce:animate-none pointer-events-none absolute inset-0" aria-hidden />
              )}
            </div>
          ) : (
            <RunList rows={rows} checked={checked} state={state} onSelect={setOpened} />
          )}
        </div>

        <div className="flex min-h-0 w-[36%] max-w-140 min-w-56 flex-none flex-col">
          {showReport ? <ResultPanel report={report.data!} checks={rows.length} command={COMMAND} /> : <EmptyColumn />}
        </div>
      </div>

      {opened && <RowDialog row={opened} onClose={() => setOpened(null)} />}
    </div>
  );
}

const Dot = () => <span aria-hidden className="size-0.5 flex-none rounded-full bg-(--primitive-opacity-white-alpha-50)" />;
