"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, getServers, putServerTrust } from "@/lib/api/client";
import { RESOURCE_REFRESH_EVENT, useResource } from "@/lib/api/use-resource";
import { TRUST_RANK, type McpServer, type TrustLevel, type TrustUpgradeConflictDetails } from "@/lib/api/types";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

// TagTone's trusted/limited/untrusted members share TrustLevel's exact spelling, so a
// TrustLevel value is already a valid `tone` — no lookup table needed.
const TRUST_OPTIONS: readonly TrustLevel[] = ["trusted", "limited", "untrusted"];

interface PendingUpgrade {
  server: McpServer;
  toTrust: TrustLevel;
  /** From the backend's 409 impact summary; undefined while that request is still in flight. */
  affectedPolicyCount: number | undefined;
}

/** SCR-501 Settings — server trust management (FR-GW-02 §6). */
export function ServerTrustSettings() {
  const t = useTranslations("settings.servers");
  const servers = useResource((signal) => getServers(signal));
  const [rows, setRows] = useState<McpServer[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<PendingUpgrade | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (servers.data) setRows(servers.data.servers);
  }, [servers.data]);

  const announce = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5_000);
  };

  const applyLocally = (id: string, trust: TrustLevel) => {
    setRows((current) => current.map((server) => (server.id === id ? { ...server, trust } : server)));
    // Home's inventory reads the same /servers list — refresh it too so both screens agree
    // immediately instead of waiting out Home's own poll interval (§6: "항상 동일한 값").
    window.dispatchEvent(new Event(RESOURCE_REFRESH_EVENT));
  };

  const changeTrust = async (server: McpServer, toTrust: TrustLevel) => {
    if (toTrust === server.trust) return;
    setPendingId(server.id);
    try {
      if (TRUST_RANK[toTrust] < TRUST_RANK[server.trust]) {
        // Downgrade: applies immediately regardless of confirmation (§5.1).
        await putServerTrust(server.id, { trustLevel: toTrust, confirmed: false });
        applyLocally(server.id, toTrust);
        announce(t("updated", { name: server.name, trust: toTrust }));
        return;
      }
      // Upgrade: surface the confirm modal right away (rank comparison already tells us this is
      // one), and separately ask the backend for the real impact summary to fill it in.
      setUpgrade({ server, toTrust, affectedPolicyCount: undefined });
      try {
        await putServerTrust(server.id, { trustLevel: toTrust, confirmed: false });
        // The backend allowed it outright (e.g. another client already confirmed) — apply and close.
        applyLocally(server.id, toTrust);
        setUpgrade(null);
        announce(t("updated", { name: server.name, trust: toTrust }));
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          const details = error.body?.details as TrustUpgradeConflictDetails | undefined;
          setUpgrade({ server, toTrust, affectedPolicyCount: details ? Number(details.affectedPolicyCount) : undefined });
        } else {
          setUpgrade(null);
          announce(t("updateFailed"));
        }
      }
    } finally {
      setPendingId(null);
    }
  };

  const confirmUpgrade = async () => {
    if (!upgrade) return;
    setPendingId(upgrade.server.id);
    try {
      await putServerTrust(upgrade.server.id, { trustLevel: upgrade.toTrust, confirmed: true });
      applyLocally(upgrade.server.id, upgrade.toTrust);
      announce(t("updated", { name: upgrade.server.name, trust: upgrade.toTrust }));
      setUpgrade(null);
    } catch {
      announce(t("updateFailed"));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-4 rounded-lg bg-grayscale-900 p-4">
      <div className="flex flex-col gap-1 pb-3 shadow-[inset_0_-1px_0_0_var(--primitive-opacity-white-alpha-10)]">
        <h2 className="text-body-text-b1-md text-grayscale-300">{t("title")}</h2>
        <p className="text-body-text-b3-rg text-grayscale-100">{t("desc")}</p>
      </div>

      <div aria-live="polite" className="min-h-6 text-body-text-b3-md text-green-500">
        {notice}
      </div>

      {servers.error && !servers.data ? (
        <p className="text-body-text-b3-md text-grayscale-400">{t("loadError")}</p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="text-caption-text-c-rg text-(--primitive-opacity-white-alpha-75)">
              <th scope="col" className="px-3 py-2 font-normal">{t("columnName")}</th>
              <th scope="col" className="px-3 py-2 font-normal">{t("columnConnection")}</th>
              <th scope="col" className="px-3 py-2 font-normal">{t("columnTrust")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((server) => (
              <tr key={server.id} className="shadow-[inset_0_-1px_0_0_var(--primitive-opacity-white-alpha-10)]">
                <td className="px-3 py-3 text-body-mono-b3-rg text-grayscale-white">{server.name}</td>
                <td className="px-3 py-3 text-body-text-b3-rg text-grayscale-100">
                  {t(server.connected ? "connected" : "disconnected")}
                </td>
                <td className="px-3 py-3">
                  <label className="sr-only" htmlFor={`trust-${server.id}`}>
                    {t("columnTrust")}
                  </label>
                  <select
                    id={`trust-${server.id}`}
                    value={server.trust}
                    disabled={pendingId === server.id}
                    onChange={(event) => void changeTrust(server, event.target.value as TrustLevel)}
                    className={cn(
                      "rounded-[4px] border-none px-2 py-1 text-caption-text-c-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400",
                      server.trust === "trusted" && "bg-(--primitive-opacity-allow-alpha-10) text-green-500",
                      server.trust === "limited" && "bg-(--primitive-opacity-warn-alpha-10) text-yellow-400",
                      server.trust === "untrusted" && "bg-(--primitive-opacity-block-alpha-10) text-red-300"
                    )}
                  >
                    {TRUST_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {upgrade && (
        <ConfirmUpgradeModal
          server={upgrade.server}
          toTrust={upgrade.toTrust}
          affectedPolicyCount={upgrade.affectedPolicyCount}
          pending={pendingId === upgrade.server.id}
          onCancel={() => setUpgrade(null)}
          onConfirm={() => void confirmUpgrade()}
        />
      )}
    </section>
  );
}

function ConfirmUpgradeModal({
  server,
  toTrust,
  affectedPolicyCount,
  pending,
  onCancel,
  onConfirm
}: {
  server: McpServer;
  toTrust: TrustLevel;
  affectedPolicyCount: number | undefined;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("settings.servers.confirmUpgrade");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onCancel}>
      <div
        role="alertdialog"
        aria-labelledby="confirm-trust-upgrade-title"
        aria-describedby="confirm-trust-upgrade-body"
        className="w-[420px] max-w-full rounded-lg bg-grayscale-900 p-6 shadow-xl shadow-black/50"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-trust-upgrade-title" className="text-body-text-b1-bd text-grayscale-white">
          {t("title")}
        </h2>
        <p id="confirm-trust-upgrade-body" className="mt-2 flex items-center gap-2 text-body-text-b3-md text-grayscale-300">
          {server.name}
          <Tag tone={server.trust} className="text-caption-text-c-md">{server.trust}</Tag>
          <span aria-hidden>→</span>
          <Tag tone={toTrust} className="text-caption-text-c-md">{toTrust}</Tag>
        </p>
        <p className="mt-3 text-body-text-b3-rg text-grayscale-100">
          {affectedPolicyCount === undefined ? t("impactLoading") : t("impact", { count: affectedPolicyCount })}
        </p>
        <p className="mt-2 text-body-text-b3-rg text-grayscale-100">{t("note")}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-9 items-center rounded-lg bg-(--primitive-opacity-white-alpha-6) px-4 text-body-text-b3-md transition-colors hover:bg-white/10"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="flex h-9 items-center rounded-lg bg-blue-800 px-4 text-body-text-b3-md transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {t("confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
