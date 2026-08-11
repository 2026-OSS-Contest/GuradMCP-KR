"use client";

import { useTranslations } from "next-intl";
import { BannerInfoIcon } from "@/components/icons";

/**
 * SCR-302 hot-reload banner: the packs on disk changed under the operator (GMCP-76), so what is
 * on screen is describing a policy set the gateway no longer runs.
 *
 * It offers the refetch rather than performing it — reloading out from under someone mid-read
 * loses their place, and the screen is still internally consistent until they say when.
 */
export interface ReloadBannerProps {
  onRefresh: () => void;
}

export function ReloadBanner({ onRefresh }: ReloadBannerProps) {
  const t = useTranslations("policies.reload");

  return (
    <div
      role="status"
      className="flex h-[37px] flex-none items-center gap-4 bg-(--primitive-opacity-warn-alpha-10) px-8"
    >
      <BannerInfoIcon aria-hidden className="size-4 flex-none" />
      <p className="text-body-text-b3-md flex-1 text-yellow-100">{t("message")}</p>
      <button
        type="button"
        onClick={onRefresh}
        className="text-body-text-b3-bd flex-none cursor-pointer text-yellow-50 underline-offset-4 hover:underline"
      >
        {t("action")}
      </button>
    </div>
  );
}
