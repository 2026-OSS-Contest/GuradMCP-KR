"use client";

import { useTranslations } from "next-intl";
import { CopyIcon } from "@/components/icons";
import { DonutGauge, GateFailIcon, GatePassIcon } from "./icons";
import type { BenchmarkReport } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const ms = (value: number) => `${value.toFixed(2)}ms`;

/**
 * One measured number against the mark it has to clear (`Panel` in the 실행완료 frame).
 * The number and the bar stay white and turn red only when the mark is missed — the value in
 * red-400, the bar in red-200, both straight from the 기준미달 export.
 */
function Metric({
  label,
  value,
  threshold,
  passed,
  /** How full the bar reads. A rate fills to its own value; a latency fills toward its ceiling. */
  fill
}: {
  label: string;
  value: string;
  threshold: string;
  passed: boolean;
  fill: number;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-(--primitive-radius-rounded-lg) border border-grayscale-800 bg-grayscale-900 p-3">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-body-text-b3-md text-grayscale-200">{label}</span>
        <span className={cn("text-body-text-b3-bd", passed ? "text-grayscale-white" : "text-red-400")}>{value}</span>
      </span>
      <span className="h-1 w-full overflow-hidden rounded-full bg-(--primitive-opacity-white-alpha-10)">
        <span
          className={cn("block h-full rounded-full", passed ? "bg-grayscale-white" : "bg-red-200")}
          style={{ width: `${Math.min(100, Math.max(0, fill * 100))}%` }}
        />
      </span>
      <span className="text-caption-text-c-md text-grayscale-300">{threshold}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-body-text-b3-md text-grayscale-300">{title}</h3>
      {children}
    </section>
  );
}

/**
 * What the run came to, beside the list that produced it (`benchmark detail` in the 실행완료
 * frame). Every threshold is printed next to the number it judges, and the command that
 * reproduces the whole thing sits at the bottom — a number nobody can re-derive is not evidence.
 */
export function ResultPanel({
  report,
  /** How many rows the list actually checked — more than `metrics.samples`, which counts only
      the labelled dataset and neither the scenarios nor the fixtures. */
  checks,
  command
}: {
  report: BenchmarkReport;
  checks: number;
  command: string;
}) {
  const t = useTranslations("benchmark");
  const { metrics: m, thresholds: th } = report;

  const copy = () => void navigator.clipboard?.writeText(command);

  return (
    // The detail column carries no card of its own — sections sit straight on the screen's
    // black, with the frame's 24/16 inset, and a 1px rule down its left edge separating it from
    // the list (`benchmark detail`, `strokeSides {left: 1}` in grayscale-800). Without it the
    // list card's own edge was the only boundary, which read as the two columns drifting apart.
    // A container, not a breakpoint: what decides the metric layout below is how wide this
    // column is, and it is a percentage of whatever the rail leaves — the same viewport gives
    // it a different width with the rail collapsed.
    <div className="@container flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto border-l border-grayscale-800 px-4 py-6">
      <div
        // The one announcement the run makes: the 245 checks themselves are not a live region.
        role="status"
        className={cn(
          "flex items-center gap-4 rounded-(--primitive-radius-rounded-xl) border p-3",
          report.passed
            ? "border-(--primitive-opacity-allow-alpha-10) bg-(--primitive-opacity-allow-alpha-10)"
            : "border-(--primitive-opacity-block-alpha-10) bg-(--primitive-opacity-block-alpha-10)"
        )}
      >
        {report.passed ? (
          <GatePassIcon className="size-6 flex-none" aria-hidden />
        ) : (
          <GateFailIcon className="size-6 flex-none" aria-hidden />
        )}
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-body-text-b1-bd text-grayscale-white">
            {t(report.passed ? "passed" : "failed")}
          </span>
          <span className="text-caption-text-c-md text-(--primitive-opacity-white-alpha-50)">
            {t("measuredOn", { count: checks })}
          </span>
        </span>
      </div>

      <Section title={t("quality")}>
        {/* Two across while there is room, four stacked when there is not. The frames measure
            the switch for us: at 1280 and 1920 the column measures 332 and 528 inside its
            padding and holds two 162/260 panels per row, while at 1024 it measures 242 and the
            four panels each take the full width.

            The threshold is 320 rather than the pair's own 332, because the column is a
            percentage and lands a whisker under the frame: 36% of the 1280 content box is
            362.9, not 364, so an exact 332 would stack the very width the frame draws two
            across. 320 sits clear of both measurements — 242 below it, 330 above. */}
        <div className="grid grid-cols-1 gap-2 @min-[320px]:grid-cols-2">
          <Metric
            label={t("metric.recall")}
            value={percent(m.recall)}
            threshold={t("atLeast", { value: percent(th.recall) })}
            passed={m.recall >= th.recall}
            fill={m.recall}
          />
          <Metric
            label={t("metric.fpr")}
            value={percent(m.fpr)}
            threshold={t("atMost", { value: percent(th.fpr) })}
            passed={m.fpr <= th.fpr}
            // A false-positive rate reads against its ceiling, so an empty bar is the good result.
            fill={th.fpr === 0 ? m.fpr : m.fpr / th.fpr}
          />
          <Metric
            label={t("metric.blockRate")}
            value={percent(m.blockRate)}
            threshold={t("atLeast", { value: percent(th.blockRate) })}
            passed={m.blockRate >= th.blockRate}
            fill={m.blockRate}
          />
          <Metric
            label={t("metric.p95")}
            value={ms(m.p95Ms)}
            threshold={t("atMost", { value: `${th.p95Ms}ms` })}
            passed={m.p95Ms <= th.p95Ms}
            fill={m.p95Ms / th.p95Ms}
          />
        </div>
      </Section>

      <Section title={t("perType")}>
        <ul className="flex flex-col gap-2">
          {report.perTypeRecall.map((row) => (
            <li
              key={row.type}
              className="flex items-center gap-4 border-b border-(--primitive-opacity-white-alpha-10) pb-2"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-body-mono-b3-rg text-grayscale-200">
                {row.type}
              </span>
              <span className="flex flex-none items-center gap-2">
                <span className="text-caption-text-c-md text-grayscale-300">
                  {row.detected}/{row.total}
                </span>
                <span className="w-14 text-right text-body-text-b3-bd text-grayscale-white">{percent(row.recall)}</span>
                {/* The number stays white either way; the ring carries the verdict. */}
                <DonutGauge value={row.recall} missed={row.recall < th.recall} />
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("validation")}>
        {/* The one number that says what the format checks are worth: the same negatives measured
            with them off, then on. Without it the low false-positive rate looks like luck. */}
        <p className="rounded-(--primitive-radius-rounded-lg) bg-(--primitive-opacity-white-alpha-6) p-3 text-body-text-b3-md text-grayscale-100">
          {t("validationBody", {
            without: percent(report.validationImpact.fprWithoutValidation),
            with: percent(report.validationImpact.fprWithValidation),
            prevented: report.validationImpact.falsePositivesPrevented
          })}
        </p>
      </Section>

      <Section title={t("reproduce")}>
        <div className="flex items-center gap-4 rounded-(--primitive-radius-rounded-lg) bg-(--primitive-opacity-black-alpha-75) p-3">
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-body-mono-b3-rg text-grayscale-300">
            {command}
          </code>
          <button
            type="button"
            onClick={copy}
            aria-label={t("copyCommand")}
            className="flex size-8 flex-none items-center justify-center rounded-(--primitive-radius-rounded-lg) bg-(--primitive-opacity-white-alpha-25) text-grayscale-white transition-opacity hover:opacity-80"
          >
            <CopyIcon className="size-5" aria-hidden />
          </button>
        </div>
      </Section>
    </div>
  );
}
