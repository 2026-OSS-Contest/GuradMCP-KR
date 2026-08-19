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
    // `w-[347px]` carries every width below 1920 — an `xl:w-[347px]` alongside it would say the
    // same thing and cost the 1920 width, because Tailwind orders an arbitrary `min-[1920px]`
    // ahead of a named `xl`, so the narrower rule would win where both apply.
    // Below 1280 the frame floats the panel free of the edges rather than flush against them:
    // inset 16px from the top, right and bottom of the content row, so at 1024 it sits at
    // 661,76 · 347x932. Floating free, it is rounded on all four corners, bordered all round and
    // lifted by its own shadow — the left-only rounding and Tailwind's shadow-2xl were standing
    // in for a panel that was still touching the edge.
    <div className="pointer-events-none absolute inset-y-4 right-4 z-10 flex w-[347px] max-w-full xl:pointer-events-auto xl:static xl:inset-y-0 xl:right-0 xl:max-w-none min-[1920px]:w-[560px]">
      <div className="pointer-events-auto flex h-full w-full flex-col rounded-2xl border border-grayscale-800 bg-grayscale-950 shadow-[0_0_12px_0_var(--primitive-opacity-black-alpha-50)] xl:rounded-none xl:border-0 xl:shadow-[inset_1px_0_0_0_var(--primitive-color-grayscale-800)]">
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
