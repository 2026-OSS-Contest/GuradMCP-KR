"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { BannerInfoIcon } from "@/components/icons";
import { getServers, getSettings, setServerTrust, updateSettings } from "@/lib/api/client";
import type { FailMode, GatewaySettings, McpServer, SettingsUpdate, TrustLevel } from "@/lib/api/types";
import { useResource } from "@/lib/api/use-resource";
import { LOCALE_COOKIE } from "@/i18n/config";
import { FailPolicy } from "./fail-policy";
import { PreferenceCards } from "./preference-cards";
import { RiskDialog } from "./risk-dialog";
import { ServerTable, isPromotion } from "./server-table";

/** A change the operator has asked for and the screen has not applied yet. */
type Pending =
  | { kind: "failOpen" }
  | { kind: "storeRaw" }
  | { kind: "trust"; server: McpServer; trust: TrustLevel };

/**
 * SCR-501 Settings (spec §5.7): which upstreams the gateway talks to, what it does when its own
 * guard is down, and what the log keeps.
 *
 * Three changes here make the system less safe than it was, and each is confirmed before it is
 * applied: fail-open, raw log storage, and raising a server's trust. Their opposites — back to
 * fail-closed, storage off, a demotion — go straight through, because reducing exposure never
 * needs a second thought.
 */
export function SettingsScreen() {
  const t = useTranslations("settings");
  const router = useRouter();
  const [pulse, setPulse] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<"saveFailed" | null>(null);

  const settings = useResource((signal) => getSettings(signal), { key: `settings-${pulse}` });
  const servers = useResource((signal) => getServers(signal), { key: `settings-servers-${pulse}` });

  const list = useMemo(() => servers.data?.servers ?? [], [servers.data]);

  const save = useCallback(async (update: SettingsUpdate) => {
    setBusy("settings");
    setNotice(null);
    try {
      await updateSettings(update);
    } catch {
      setNotice("saveFailed");
    } finally {
      setBusy(null);
      setPending(null);
      setPulse((previous) => previous + 1);
    }
  }, []);

  const applyTrust = useCallback(async (server: McpServer, trust: TrustLevel) => {
    setBusy(server.id);
    setNotice(null);
    try {
      await setServerTrust(server.id, trust);
    } catch {
      setNotice("saveFailed");
    } finally {
      setBusy(null);
      setPending(null);
      setPulse((previous) => previous + 1);
    }
  }, []);

  /**
   * next-intl resolves the language from the `NEXT_LOCALE` cookie on the server, so persisting
   * the preference to the gateway changes a stored value and nothing on screen. The cookie is
   * what switches the page; the refresh is what re-renders it with the other message file.
   */
  const changeLocale = useCallback(
    async (locale: GatewaySettings["locale"]) => {
      document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
      await save({ locale });
      router.refresh();
    },
    [save, router]
  );

  const onFailModeChange = (mode: FailMode) => {
    if (mode === "fail_open") return setPending({ kind: "failOpen" });
    void save({ failMode: mode });
  };

  const onStoreRawChange = (next: boolean) => {
    if (next) return setPending({ kind: "storeRaw" });
    void save({ storeRawOptIn: false });
  };

  const onTrustChange = (server: McpServer, trust: TrustLevel) => {
    if (trust === server.trust) return;
    if (isPromotion(server.trust, trust)) return setPending({ kind: "trust", server, trust });
    void applyTrust(server, trust);
  };

  if ((settings.loading || servers.loading) && !(settings.data && servers.data)) {
    return <p className="text-body-text-b3-md p-8 text-grayscale-400">{t("loading")}</p>;
  }

  const current: GatewaySettings | undefined = settings.data;
  if (!current) {
    return <p className="text-body-text-b3-md p-8 text-grayscale-400">{t("error")}</p>;
  }

  return (
    <div data-scr="SCR-501" className="flex min-h-0 flex-1 flex-col">
      {notice && (
        <p
          role="status"
          className="text-body-text-b3-md flex items-center gap-2 bg-grayscale-700 px-8 py-3 text-grayscale-white"
        >
          <BannerInfoIcon className="size-4 flex-none" aria-hidden />
          {t(notice)}
        </p>
      )}

      {/* The design's 1280 page: a 1040 column inset 24/32, the upstream table across the top and
          two 480px columns beneath it. */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-8 py-6">
        <ServerTable servers={list} onTrustChange={onTrustChange} busy={busy} />

        {/* Two even columns at every width the design draws — 352 at 1024, 480 at 1280, 800 at
            1920 — so the split starts at `lg` rather than `xl`. Below that there is no frame,
            and stacking is the only thing that fits. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <FailPolicy value={current.failMode} onChange={onFailModeChange} disabled={busy === "settings"} />
          <PreferenceCards
            settings={current}
            onStoreRawChange={onStoreRawChange}
            onLocaleChange={(locale) => void changeLocale(locale)}
            onTimeoutChange={(approvalTimeoutSeconds) => void save({ approvalTimeoutSeconds })}
            disabled={busy === "settings"}
          />
        </div>
      </div>

      {pending?.kind === "failOpen" && (
        <RiskDialog
          title={t("failOpenDialog.title")}
          body={t("failOpenDialog.body")}
          acknowledgement={t("failOpenDialog.acknowledge")}
          confirmLabel={t("failOpenDialog.confirm")}
          pending={busy === "settings"}
          onCancel={() => setPending(null)}
          onConfirm={() => void save({ failMode: "fail_open" })}
        />
      )}

      {pending?.kind === "storeRaw" && (
        <RiskDialog
          title={t("storeRawDialog.title")}
          body={t("storeRawDialog.body")}
          confirmLabel={t("storeRawDialog.confirm")}
          pending={busy === "settings"}
          onCancel={() => setPending(null)}
          onConfirm={() => void save({ storeRawOptIn: true })}
        />
      )}

      {pending?.kind === "trust" && (
        <RiskDialog
          title={t("trustDialog.title")}
          body={t("trustDialog.body", { name: pending.server.name, trust: pending.trust })}
          confirmLabel={t("trustDialog.confirm")}
          pending={busy === pending.server.id}
          onCancel={() => setPending(null)}
          onConfirm={() => void applyTrust(pending.server, pending.trust)}
        />
      )}
    </div>
  );
}
