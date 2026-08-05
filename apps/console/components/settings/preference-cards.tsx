"use client";

import { useTranslations } from "next-intl";
import type { GatewaySettings } from "@/lib/api/types";
import { Switch } from "@/components/ui/switch";

/** The windows the design offers for a held call. 120s is the gateway's own default. */
const TIMEOUTS = [60, 120, 300] as const;

const LOCALES = ["ko", "en"] as const;

/**
 * The right column of SCR-501: what the audit log keeps, and the two preferences that are not
 * about safety at all.
 *
 * Raw storage is the one with teeth — turning it on means the log starts keeping exactly the
 * text the gateway exists to redact — so the screen explains itself before applying it. The
 * language and the approval window need no such ceremony.
 */
export interface PreferenceCardsProps {
  settings: GatewaySettings;
  onStoreRawChange: (next: boolean) => void;
  onLocaleChange: (locale: GatewaySettings["locale"]) => void;
  onTimeoutChange: (seconds: number) => void;
  disabled?: boolean;
}

export function PreferenceCards({
  settings,
  onStoreRawChange,
  onLocaleChange,
  onTimeoutChange,
  disabled
}: PreferenceCardsProps) {
  const t = useTranslations("settings");

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="log-title" className="flex flex-col gap-4">
        <h2 id="log-title" className="text-body-text-b3-md text-grayscale-300">
          {t("log.title")}
        </h2>
        <div className="flex items-center gap-4 rounded-xl bg-grayscale-900 p-3 px-4 py-5">
          <span className="text-body-text-b2-md flex-1 text-grayscale-white">{t("log.storeRaw")}</span>
          <Switch
            checked={settings.storeRawOptIn}
            disabled={disabled}
            onChange={onStoreRawChange}
            label={t("log.storeRaw")}
          />
        </div>
      </section>

      <section aria-labelledby="general-title" className="flex flex-col gap-4">
        <h2 id="general-title" className="text-body-text-b3-md text-grayscale-300">
          {t("general.title")}
        </h2>
        <div className="flex flex-col gap-4 rounded-xl bg-grayscale-900 px-4 py-5">
          <label className="flex items-center gap-4">
            <span className="text-body-text-b2-md flex-1 text-grayscale-white">{t("general.locale")}</span>
            <select
              value={settings.locale}
              disabled={disabled}
              onChange={(event) => onLocaleChange(event.target.value as GatewaySettings["locale"])}
              className="text-body-text-b3-md w-32 cursor-pointer rounded-lg bg-grayscale-800 px-3 py-2 text-grayscale-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {LOCALES.map((locale) => (
                <option key={locale} value={locale} className="bg-grayscale-800">
                  {t(`general.localeName.${locale}`)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-4">
            <span className="text-body-text-b2-md flex-1 text-grayscale-white">{t("general.approvalTimeout")}</span>
            <select
              value={settings.approvalTimeoutSeconds}
              disabled={disabled}
              onChange={(event) => onTimeoutChange(Number(event.target.value))}
              className="text-body-text-b3-md w-32 cursor-pointer rounded-lg bg-grayscale-800 px-3 py-2 text-grayscale-white tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {TIMEOUTS.map((seconds) => (
                <option key={seconds} value={seconds} className="bg-grayscale-800">
                  {seconds}
                </option>
              ))}
            </select>
            <span className="text-body-text-b3-md flex-none text-grayscale-400">{t("general.seconds")}</span>
          </label>
        </div>
      </section>
    </div>
  );
}
