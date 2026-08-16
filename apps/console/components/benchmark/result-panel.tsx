"use client";

import { useTranslations } from "next-intl";
import { CopyIcon, VerdictAllowIcon, VerdictBlockIcon } from "@/components/icons";
import type { BenchmarkReport } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const ms = (value: number) => `${value.toFixed(2)}ms`;

/** Fixed format, like `lib/time.ts`: the stamp is part of a record and must not shift by locale. */
const stamp = (iso: string) => {
  const at = new Date(iso);
  return `${at.toLocaleDateString("en-CA")} ${at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};

/**
 * Green is a verdict, not a decoration.
 *
 * The first draft coloured every measurement that cleared its mark, and on a run that passes
 * everything that is twenty-odd green numbers — which says nothing, and leaves a single failure
 * nowhere to stand out. So the gate card announces the verdict in green and the run list marks
 * each row, while the numbers themselves stay neutral and turn red only where a mark is missed.
 */
const MEASURED = "text-grayscale-white";
const MISSED = "text-verdict-block";

/** One measured number against the mark it has to clear (docs/benchmark-gate.md 12.2). */
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
    <div className="flex flex-col gap-2 rounded-lg bg-grayscale-900 p-3 shadow-[inset_0_0_0_1px_var(--primitive-color-grayscale-800)]">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-body-text-b3-md text-grayscale-300">{label}</span>
        <span className={cn("text-body-text-b2-bd", passed ? MEASURED : MISSED)}>{value}</span>
      </span>
      {/* The bar carries the reading; the number beside it is what a reader quotes. */}
      <span className="h-1 w-full overflow-hidden rounded-full bg-(--primitive-opacity-white-alpha-10)">
        <span
          className={cn("block h-full rounded-full", passed ? "bg-grayscale-300" : "bg-verdict-block")}
          style={{ width: `${Math.min(100, Math.max(0, fill * 100))}%` }}
        />
      </span>
      <span className="text-caption-text-c-rg text-(--primitive-opacity-white-alpha-50)">{threshold}</span>
    </div>
  );
}

/**
 * The same fraction the row states, read at a glance. A ring rather than a bar because these sit
 * in a column of eleven: a bar would make eleven near-identical full lines, where a ring that is
 * short by a slice is visible at 20px.
 */
function Donut({ value, missed }: { value: number; missed: boolean }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 20 20" className="size-5 flex-none -rotate-90" aria-hidden>
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        strokeWidth="3"
        className="stroke-(--primitive-opacity-white-alpha-10)"
      />
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${circumference * Math.min(1, Math.max(0, value))} ${circumference}`}
        // The console's own blue — the one the primary buttons and the selected rows use.
        className={missed ? "stroke-verdict-block" : "stroke-blue-800"}
      />
    </svg>
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
 * What the run came to, beside the list that produced it (GMCP-61).
 *
 * Every threshold is printed next to the number it judges, and the command that reproduces the
 * whole thing is at the bottom — the ticket asks for a screen that can be used as evidence, and a
 * number nobody can re-derive is not evidence.
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
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <div
        // The one announcement the run makes: the 245 checks themselves are not a live region.
        role="status"
        className={cn(
          "flex items-center gap-3 rounded-xl p-4",
          report.passed
            ? "bg-(--primitive-opacity-allow-alpha-10) shadow-[inset_0_0_0_1px_var(--primitive-opacity-allow-alpha-10)]"
            : "bg-(--primitive-opacity-block-alpha-10) shadow-[inset_0_0_0_1px_var(--primitive-opacity-block-alpha-10)]"
        )}
      >
        {report.passed ? (
          <VerdictAllowIcon className="h-6 w-5 flex-none text-verdict-allow" aria-hidden />
        ) : (
          <VerdictBlockIcon className="h-6 w-5 flex-none text-verdict-block" aria-hidden />
        )}
        <span className="flex min-w-0 flex-col">
          <span className="text-body-text-b1-bd text-grayscale-white">
            {t(report.passed ? "passed" : "failed")}
          </span>
          <span className="text-caption-text-c-rg text-(--primitive-opacity-white-alpha-75)">
            {t("measuredOn", { count: checks })}
          </span>
        </span>
      </div>

      <Section title={t("quality")}>
        {/* Two up while the panel holds its full width; one column once the window has taken
            that away, where a two-up pair would be two 130px boxes with a percentage in each. */}
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
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
        <ul className="flex flex-col">
          {report.perTypeRecall.map((row) => (
            <li
              key={row.type}
              className="flex items-center gap-3 py-2 shadow-[inset_0_-1px_0_0_var(--primitive-opacity-white-alpha-10)]"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-caption-mono-c-rg text-grayscale-200">
                {row.type}
              </span>
              <span className="flex-none text-caption-text-c-rg text-(--primitive-opacity-white-alpha-50)">
                {row.detected}/{row.total}
              </span>
              <span
                className={cn(
                  "w-14 flex-none text-right text-body-text-b3-md",
                  row.recall >= th.recall ? MEASURED : MISSED
                )}
              >
                {percent(row.recall)}
              </span>
              <Donut value={row.recall} missed={row.recall < th.recall} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t("validation")}>
        {/* The one number that says what the format checks are worth: the same negatives measured
            with them off, then on. Without it the low false-positive rate looks like luck. */}
        <p className="rounded-lg bg-(--primitive-opacity-white-alpha-6) p-3 text-body-text-b3-md text-grayscale-200">
          {t("validationBody", {
            without: percent(report.validationImpact.fprWithoutValidation),
            with: percent(report.validationImpact.fprWithValidation),
            prevented: report.validationImpact.falsePositivesPrevented
          })}
        </p>
      </Section>

      <Section title={t("reproduce")}>
        <div className="flex items-center gap-2 rounded-lg bg-(--primitive-opacity-black-alpha-75) p-3">
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-body-mono-b3-rg text-grayscale-200">
            {command}
          </code>
          <button
            type="button"
            onClick={copy}
            aria-label={t("copyCommand")}
            className="flex size-8 flex-none items-center justify-center rounded-lg bg-(--primitive-opacity-white-alpha-25) text-grayscale-300 transition-colors hover:text-grayscale-white"
          >
            <CopyIcon className="size-5" aria-hidden />
          </button>
        </div>
        <p className="text-caption-text-c-rg text-(--primitive-opacity-white-alpha-50)">
          {t("generatedAt", { at: stamp(report.generatedAt) })}
        </p>
      </Section>
    </div>
  );
}
