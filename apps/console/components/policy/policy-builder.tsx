"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  getDryRunStats,
  getPolicies,
  getPolicy,
  setPackEnabled,
  setPolicyEnabled
} from "@/lib/api/client";
import type { PolicyPack, PolicyRow } from "@/lib/api/types";
import { useResource } from "@/lib/api/use-resource";
import { createSseClient } from "@/lib/sse";
import { MOCK_API } from "@/mocks/scenario";
import { DisableConfirm, needsConfirm } from "./disable-confirm";
import { PackTree } from "./pack-tree";
import { PolicyEmpty } from "./policy-empty";
import { PolicyTable } from "./policy-table";
import { ReloadBanner } from "./reload-banner";
import { YamlPane } from "./yaml-pane";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;
const STREAM_URL = API_BASE ? `${API_BASE}/api/v1/events/stream` : MOCK_API ? "/api/v1/events/stream" : null;

/**
 * SCR-302 Policy Builder (spec §5.5, FR-POL-02/04): which packs are loaded, what they decide,
 * and the YAML behind each rule.
 *
 * Read-plus-a-switch by design. Authoring policies is a file operation — the console never
 * writes YAML, so there is no create, edit or delete here, only `enabled`.
 */
export function PolicyBuilder() {
  const t = useTranslations("policies");
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [selectedPolicy, setSelectedPolicy] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** The policy a confirmation is currently holding, if any. */
  const [confirming, setConfirming] = useState<PolicyRow | null>(null);
  /** Raised by `policy.reloaded`; cleared when the operator takes the refetch. */
  const [reloaded, setReloaded] = useState(false);
  /** Bumped to refetch — on the banner's action, and after every toggle. */
  const [pulse, setPulse] = useState(0);

  const policies = useResource((signal) => getPolicies(signal), { key: `policies-${pulse}` });
  const stats = useResource((signal) => getDryRunStats(signal), { key: `dry-run-${pulse}` });

  const packs = useMemo(() => policies.data?.packs ?? [], [policies.data]);
  const rows = useMemo(() => policies.data?.policies ?? [], [policies.data]);

  // The gateway reloaded the packs on disk, so the screen is describing a policy set that is no
  // longer running. Offer the refetch rather than yanking the view out from under the operator.
  useEffect(() => {
    if (!STREAM_URL) return;
    const client = createSseClient({
      url: STREAM_URL,
      onMessage: (message) => {
        if (message.type === "policy.reloaded") setReloaded(true);
      }
    });
    return () => client.close();
  }, []);

  const refresh = useCallback(() => {
    setReloaded(false);
    setPulse((previous) => previous + 1);
  }, []);

  // Selection follows the data rather than being seeded once: the first load has no packs yet,
  // and a reload can retire whatever was selected.
  const pack = selectedPack && packs.some((entry) => entry.name === selectedPack) ? selectedPack : packs[0]?.name ?? null;
  const visible = useMemo(() => rows.filter((row) => row.pack === pack), [rows, pack]);
  const policy = useMemo(
    () => visible.find((row) => row.id === selectedPolicy) ?? visible[0] ?? null,
    [visible, selectedPolicy]
  );

  const yaml = useResource(
    (signal) => (policy ? getPolicy(policy.id, signal) : Promise.resolve(undefined)),
    { key: `policy-yaml-${policy?.id ?? "none"}` }
  );

  const applyPolicy = useCallback(
    async (row: PolicyRow, enabled: boolean) => {
      setBusy(row.id);
      try {
        await setPolicyEnabled(row.id, enabled);
        setPulse((previous) => previous + 1);
      } catch {
        // The refetch below re-reads the truth either way, so a failed toggle simply snaps back
        // rather than leaving the switch showing something the gateway never accepted.
        setPulse((previous) => previous + 1);
      } finally {
        setBusy(null);
        setConfirming(null);
      }
    },
    []
  );

  const onPolicyToggle = useCallback(
    (row: PolicyRow, enabled: boolean) => {
      // Turning protection *off* is what gets questioned; turning it back on never does.
      if (!enabled && needsConfirm(row)) {
        setConfirming(row);
        return;
      }
      void applyPolicy(row, enabled);
    },
    [applyPolicy]
  );

  const onPackToggle = useCallback(async (entry: PolicyPack, enabled: boolean) => {
    setBusy(entry.name);
    try {
      await setPackEnabled(entry.name, enabled);
    } finally {
      setBusy(null);
      setPulse((previous) => previous + 1);
    }
  }, []);

  if (policies.loading && !policies.data) {
    return <p className="text-body-text-b3-md p-8 text-grayscale-400">{t("loading")}</p>;
  }

  if (policies.error && !policies.data) {
    return <p className="text-body-text-b3-md p-8 text-grayscale-400">{t("error")}</p>;
  }

  if (packs.length === 0) {
    return (
      <div className="flex flex-1 flex-col">
        {reloaded && <ReloadBanner onRefresh={refresh} />}
        <PolicyEmpty />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {reloaded && <ReloadBanner onRefresh={refresh} />}
      {/* The design's 1280 grid: 232 / 463 / 347 across the 1040 content column. */}
      <div className="grid flex-1 grid-cols-1 gap-px bg-grayscale-800 lg:grid-cols-[232px_minmax(0,1fr)_347px]">
        <div className="bg-grayscale-950 px-4 py-6">
          <PackTree
            packs={packs}
            selected={pack}
            onSelect={(name) => {
              setSelectedPack(name);
              // The previous selection belongs to another pack's table.
              setSelectedPolicy(null);
            }}
            onToggle={onPackToggle}
            busy={busy}
          />
        </div>
        <div className="min-w-0 bg-grayscale-950 px-6 py-6">
          <PolicyTable
            policies={visible}
            selected={policy?.id ?? null}
            onSelect={setSelectedPolicy}
            onToggle={onPolicyToggle}
            busy={busy}
          />
        </div>
        <div className="bg-grayscale-950 px-6 py-6">
          <YamlPane policy={policy} yaml={yaml.data?.yaml} loading={yaml.loading} stats={stats.data?.stats ?? []} />
        </div>
      </div>

      {confirming && (
        <DisableConfirm
          policy={confirming}
          pending={busy === confirming.id}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void applyPolicy(confirming, false)}
        />
      )}
    </div>
  );
}
