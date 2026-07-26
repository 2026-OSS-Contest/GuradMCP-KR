"use client";

import { useTranslations } from "next-intl";
import { useReplay } from "./replay-provider";
import { EventDetailPanel } from "./event-detail";

/**
 * SCR-301 right column. At ≥1280 it is a fixed third column with a left rule; below that it
 * becomes a slide-over that floats over the timeline (spec §4.5).
 */
export function DetailColumn() {
  const t = useTranslations("replay.detail");
  const { selectedDetail, timeline } = useReplay();

  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-[347px] max-w-full xl:pointer-events-auto xl:static xl:w-[347px] xl:max-w-none min-[1920px]:w-[560px]">
      <div className="pointer-events-auto flex h-full w-full flex-col rounded-l-2xl bg-grayscale-950 shadow-2xl shadow-black/50 xl:rounded-none xl:shadow-[inset_1px_0_0_0_var(--primitive-color-grayscale-800)]">
        {selectedDetail ? (
          <EventDetailPanel detail={selectedDetail} />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-body-text-b3-md text-grayscale-400">
            {timeline.loading ? "" : t("noSelection")}
          </div>
        )}
      </div>
    </div>
  );
}
