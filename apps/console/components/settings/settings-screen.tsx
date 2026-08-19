"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { BannerInfoIcon } from "@/components/icons";
import { ApiError, getServers, getSettings, putServerTrust, updateSettings } from "@/lib/api/client";
import { hasOperatorPermissions } from "@/lib/api/permissions";
import type {
  FailMode,
  GatewaySettings,
  McpServer,
  SettingsUpdate,
  TrustLevel,
  TrustUpgradeConflictDetails
} from "@/lib/api/types";
import { useResource } from "@/lib/api/use-resource";
import { LOCALE_COOKIE } from "@/i18n/config";
import { FailPolicy } from "./fail-policy";
import { PreferenceCards } from "./preference-cards";
import { RiskDialog } from "./risk-dialog";
import { ServerTable } from "./server-table";

/** A change the operator has asked for and the screen has not applied yet. */
type Pending =
  | { kind: "failOpen" }
  | { kind: "storeRaw" }
  /** `impact` is what the gateway's 409 said the upgrade would cost, not a client-side guess. */
  | { kind: "trust"; server: McpServer; trust: TrustLevel; impact?: TrustUpgradeConflictDetails };

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
  /** Confirmation that a trust change landed — the one write with no visible result of its own. */
  const [toast, setToast] = useState<string | null>(null);

  const settings = useResource((signal) => getSettings(signal), { key: `settings-${pulse}` });
  const servers = useResource((signal) => getServers(signal), { key: `settings-servers-${pulse}` });

  const list = useMemo(() => servers.data?.servers ?? [], [servers.data]);

  const save = useCallback(async (update: SettingsUpdate) => {
    setBusy("settings");
    setNotice(null);
    try {
      const result = await updateSettings(update);
      // GMCP-84 §6.2: the true→false rawPayloadStorageEnabled response carries a retention note
      // ("기존에 저장된 원문은 유지됩니다...") — surface it the same way a trust change surfaces its toast.
      if (result.note) setToast(result.note);
      else if (update.rawPayloadStorageEnabled === true) setToast(t("storeRawDialog.enabledToast"));
    } catch {
      setNotice("saveFailed");
    } finally {
      setBusy(null);
      setPending(null);
      setPulse((previous) => previous + 1);
    }
  }, [t]);

  /**
   * FR-GW-02 §5.1: the gateway decides which changes need a second look. A demotion is applied
   * on the first request; an upgrade comes back 409 with the policies it would stop applying,
   * and only a `confirmed` repeat goes through. Asking the server rather than ranking the tiers
   * here means the dialog quotes the real impact instead of a number the console guessed.
   */
  const applyTrust = useCallback(async (server: McpServer, trust: TrustLevel, confirmed: boolean) => {
    setBusy(server.id);
    setNotice(null);
    try {
      await putServerTrust(server.id, { trustLevel: trust, confirmed });
      setToast(t("servers.updated", { name: server.name, trust }));
      setPending(null);
      setPulse((previous) => previous + 1);
    } catch (error) {
      const conflict =
        error instanceof ApiError && error.status === 409 ? error.body?.details : undefined;
      if (conflict) {
        setPending({
          kind: "trust",
          server,
          trust,
          impact: conflict as unknown as TrustUpgradeConflictDetails
        });
        return;
      }
      setNotice("saveFailed");
      setPending(null);
      setPulse((previous) => previous + 1);
    } finally {
      setBusy(null);
    }
  }, [t]);

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
    void save({ rawPayloadStorageEnabled: false });
  };

  const onTrustChange = (server: McpServer, trust: TrustLevel) => {
    if (trust === server.trust) return;
    setToast(null);
    // Unconfirmed either way: a demotion lands, an upgrade comes back 409 and opens the dialog.
    void applyTrust(server, trust, false);
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
          <BannerInfoIcon className="size-4 flex-none text-(--primitive-color-yellow-100)" aria-hidden />
          {t(notice)}
        </p>
      )}

      {/* A trust change leaves no trace on screen beyond the select it came from, so the screen
          says what it did. `role="status"` so it reaches a screen reader too. */}
      {toast && (
        <p
          role="status"
          className="text-body-text-b3-md flex items-center gap-2 bg-grayscale-800 px-8 py-3 text-grayscale-white"
        >
          <BannerInfoIcon className="size-4 flex-none text-(--primitive-color-yellow-100)" aria-hidden />
          {toast}
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
            // GMCP-84 §8.1: `settings:write` (the same claim `events:reveal` uses, §7) is required
            // specifically for this toggle — every other control on this screen is unaffected.
            storeRawDisabled={busy === "settings" || !hasOperatorPermissions()}
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
          onConfirm={() => void save({ failMode: "fail_open", riskAcknowledged: true })}
        />
      )}

      {pending?.kind === "storeRaw" && (
        <RiskDialog
          title={t("storeRawDialog.title")}
          body={t("storeRawDialog.body")}
          // GMCP-84 §8.1: unlike the pre-84 version of this dialog, turning raw storage on now
          // requires the same explicit checkbox fail-open does — the control plane 422s a
          // false→true PUT without `acknowledgedNotice: true` regardless (§6.2), so the checkbox
          // is not just UX polish here.
          acknowledgement={t("storeRawDialog.acknowledge")}
          confirmLabel={t("storeRawDialog.confirm")}
          pending={busy === "settings"}
          onCancel={() => setPending(null)}
          onConfirm={() => void save({ rawPayloadStorageEnabled: true, acknowledgedNotice: true })}
        />
      )}

      {pending?.kind === "trust" && (
        <RiskDialog
          title={t("servers.confirmUpgrade.title")}
          body={`${pending.server.name} — ${
            pending.impact
              ? t("servers.confirmUpgrade.impact", { count: pending.impact.affectedPolicyCount })
              : t("servers.confirmUpgrade.impactLoading")
          }`}
          note={t("servers.confirmUpgrade.note")}
          confirmLabel={t("servers.confirmUpgrade.confirm")}
          pending={busy === pending.server.id}
          onCancel={() => setPending(null)}
          onConfirm={() => void applyTrust(pending.server, pending.trust, true)}
        />
      )}
    </div>
  );
}
