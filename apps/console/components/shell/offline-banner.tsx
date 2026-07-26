"use client";

import { useTranslations } from "next-intl";
import { isOffline, useOverview } from "@/components/providers/overview-provider";
import { BannerInfoIcon } from "@/components/icons";

/**
 * Global banner pinned under the status bar whenever the gateway is unreachable
 * (spec §4.2). The last successful poll is stamped next to it, so the stale numbers still
 * on screen are readable as stale.
 */
export function OfflineBanner() {
  const t = useTranslations("shell");
  const overview = useOverview();

  if (!isOffline(overview)) return null;

  return (
    <div role="status" className="flex flex-none items-center gap-4 bg-(--primitive-opacity-warn-alpha-10) px-8">
      <span className="flex flex-1 items-center gap-2 py-2 text-body-text-b3-md text-yellow-100">
        <BannerInfoIcon className="size-4 flex-none" aria-hidden />
        {t("offlineBanner")}
      </span>
      {overview.fetchedAt && (
        <span className="flex flex-none items-center gap-2 py-2 text-body-text-b3-md text-(--primitive-opacity-white-alpha-75)">
          {t("lastFetched")}
          <time dateTime={overview.fetchedAt.toISOString()}>
            {overview.fetchedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          </time>
        </span>
      )}
    </div>
  );
}
