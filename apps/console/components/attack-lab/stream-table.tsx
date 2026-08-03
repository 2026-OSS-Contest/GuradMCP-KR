"use client";

import { useTranslations } from "next-intl";
import type { StreamRow } from "@/lib/api/types";
import { BannerInfoIcon } from "@/components/icons";
import { VerdictBadge } from "@/components/verdict-badge";
import { cn } from "@/lib/utils";

/**
 * The gateway's event feed for the run (spec §5.2 no.6). Wider than the cards: it also reports
 * the calls that passed without a card of their own, each with its risk score.
 */
export function StreamTable({ rows }: { rows: StreamRow[] }) {
  const t = useTranslations("attackLab");

  return (
    <section aria-label={t("liveStream")} className="flex flex-none flex-col gap-3 rounded-xl bg-grayscale-900 p-4">
      <h2 className="text-body-text-b3-md text-grayscale-300">{t("liveStream")}</h2>

      {rows.length === 0 ? (
        <>
          <StreamHeader />
          <p className="flex items-center justify-center gap-2 py-10 text-body-text-b3-md text-grayscale-400">
            <BannerInfoIcon className="size-4 flex-none" aria-hidden />
            {t("streamEmpty")}
          </p>
        </>
      ) : (
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="bg-(--primitive-opacity-white-alpha-6) text-left text-body-text-b3-md text-grayscale-300">
              <th scope="col" className="w-28 rounded-l-md px-4 py-3 font-normal">{t("colTime")}</th>
              <th scope="col" className="px-4 py-3 font-normal">{t("colToolCall")}</th>
              <th scope="col" className="w-56 px-4 py-3 font-normal">{t("colVerdict")}</th>
              <th scope="col" className="w-36 rounded-r-md px-4 py-3 font-normal">{t("colRisk")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="shadow-[inset_0_-1px_0_0_var(--primitive-opacity-white-alpha-10)]">
                <td className="px-4 py-3 text-caption-text-c-rg text-(--primitive-opacity-white-alpha-75)">{row.at}</td>
                <td className="truncate px-4 py-3 font-mono text-body-mono-b2-rg text-grayscale-white">{row.tool}</td>
                <td className="px-4 py-3">
                  <span className="flex flex-wrap items-center gap-2">
                    <VerdictBadge verdict={row.verdict} size="sm" />
                    {row.target && (
                      <span className="font-mono text-caption-mono-c-rg text-(--primitive-opacity-white-alpha-75)">
                        {row.target}
                      </span>
                    )}
                  </span>
                </td>
                <td className={cn("px-4 py-3 text-body-text-b2-md", row.verdict === "block" ? "text-verdict-block" : "text-grayscale-white")}>
                  {row.risk}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** The empty state still shows the columns, so the table reads as a table before any data. */
function StreamHeader() {
  const t = useTranslations("attackLab");
  return (
    <div className="grid grid-cols-[8rem_1fr_16rem_12rem] rounded-md bg-(--primitive-opacity-white-alpha-6) text-body-text-b3-md text-grayscale-300">
      <span className="px-4 py-3">{t("colTime")}</span>
      <span className="px-4 py-3">{t("colToolCall")}</span>
      <span className="px-4 py-3">{t("colVerdict")}</span>
      <span className="px-4 py-3">{t("colRisk")}</span>
    </div>
  );
}
