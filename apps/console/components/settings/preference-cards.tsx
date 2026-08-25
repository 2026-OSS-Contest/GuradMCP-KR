"use client";

import { useLocale, useTranslations } from "next-intl";
import type { GatewaySettings } from "@/lib/api/types";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { locales } from "@/i18n/config";

/** The windows the design offers for a held call. 120s is the gateway's own default. */
const TIMEOUTS = [60, 120, 300] as const;


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
  /** GMCP-84 §8.1: `settings:write`-gated separately from the other controls on this screen —
   *  see `SettingsScreen`'s doc comment on the prop it passes here. */
  storeRawDisabled?: boolean;
}

export function PreferenceCards({
  settings,
  onStoreRawChange,
  onLocaleChange,
  onTimeoutChange,
  disabled,
  storeRawDisabled
}: PreferenceCardsProps) {
  const t = useTranslations("settings");
  // The cookie is what the page is actually rendered in; `settings.locale` is a stored preference
  // that a fresh gateway — or a reset mock — can disagree with. Show the one in effect.
  const locale = useLocale();

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="log-title" className="flex flex-col gap-4">
        <h2 id="log-title" className="text-body-text-b3-md text-grayscale-300">
          {t("log.title")}
        </h2>
        <div className="flex flex-col gap-1 rounded-(--primitive-radius-rounded-xl) bg-grayscale-900 p-3 px-4 py-5">
          <div className="flex items-center gap-4" title={storeRawDisabled ? t("log.storeRawPermissionRequired") : undefined}>
            <span className="text-body-text-b2-md flex-1 text-grayscale-white">{t("log.storeRaw")}</span>
            <Switch
              checked={settings.rawPayloadStorageEnabled}
              disabled={disabled || storeRawDisabled}
              onChange={onStoreRawChange}
              label={t("log.storeRaw")}
            />
          </div>
          <p className="text-caption-text-c-rg text-grayscale-400">{t("log.storeRawHint")}</p>
        </div>
      </section>

      <section aria-labelledby="general-title" className="flex flex-col gap-4">
        <h2 id="general-title" className="text-body-text-b3-md text-grayscale-300">
          {t("general.title")}
        </h2>
        <div className="flex flex-col gap-4 rounded-(--primitive-radius-rounded-xl) bg-grayscale-900 px-4 py-5">
          <label className="flex items-center gap-3">
            <span className="text-body-text-b2-md w-35 flex-none text-grayscale-white">{t("general.locale")}</span>
            <Select
              value={locale}
              disabled={disabled}
              label={t("general.locale")}
              onChange={(next) => onLocaleChange(next as GatewaySettings["locale"])}
              className="text-body-text-b3-md h-8 w-25"
            >
              {locales.map((code) => (
                <option key={code} value={code} className="bg-grayscale-800">
                  {t(`general.localeName.${code}`)}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex items-center gap-3">
            <span className="text-body-text-b2-md w-35 flex-none text-grayscale-white">
              {t("general.approvalTimeout")}
            </span>
            <Select
              value={settings.approvalTimeoutSeconds}
              disabled={disabled}
              label={t("general.approvalTimeout")}
              onChange={(next) => onTimeoutChange(Number(next))}
              className="text-body-text-b3-md h-8 w-25 tabular-nums"
            >
              {TIMEOUTS.map((seconds) => (
                <option key={seconds} value={seconds} className="bg-grayscale-800">
                  {seconds}
                </option>
              ))}
            </Select>
            <span className="text-body-text-b3-md -ml-1 flex-none text-grayscale-400">{t("general.seconds")}</span>
          </label>
        </div>
      </section>
    </div>
  );
}
