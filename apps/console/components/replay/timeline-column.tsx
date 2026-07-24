"use client";

import { useTranslations } from "next-intl";

/**
 * SCR-301 centre column — the Timeline Rail and playback controls (GMCP-11).
 *
 * This is a scaffold placeholder so the three-column page composes on GMCP-34; GMCP-11 replaces
 * it with the real rail. It reserves the flexible centre width the detail slide-over floats over.
 */
export function TimelineColumn() {
  const t = useTranslations("replay.timeline");
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-4 px-4 py-6">
      <h2 className="text-body-text-b3-md text-grayscale-300">{t("title")}</h2>
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-grayscale-800 text-body-text-b3-md text-grayscale-500">
        {t("scaffold")}
      </div>
    </section>
  );
}
