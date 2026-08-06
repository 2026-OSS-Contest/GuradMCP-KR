"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Info } from "lucide-react";
import {
  getDryRunStats,
  getPolicies,
  getPolicy,
  getPolicyPacks,
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
  /** What the last toggle has to say for itself, if anything. */
  const [notice, setNotice] = useState<"toggleFailed" | null>(null);
  /** Bumped to refetch — on the banner's action, and after every toggle. */
  const [pulse, setPulse] = useState(0);

  // Packs and policies are two endpoints answering bare arrays, so the join happens here.
  const packsResource = useResource((signal) => getPolicyPacks(signal), { key: `policy-packs-${pulse}` });
  const policies = useResource((signal) => getPolicies(signal), { key: `policies-${pulse}` });
  const stats = useResource((signal) => getDryRunStats(signal), { key: `dry-run-${pulse}` });

  const packs = useMemo(() => packsResource.data ?? [], [packsResource.data]);
  const rows = useMemo(() => policies.data ?? [], [policies.data]);

  /** The count beside each pack; the control plane reports none, so the join supplies it. */
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const row of rows) out[row.packId] = (out[row.packId] ?? 0) + 1;
    return out;
  }, [rows]);

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
  const pack = selectedPack && packs.some((entry) => entry.id === selectedPack) ? selectedPack : packs[0]?.id ?? null;
  const visible = useMemo(() => rows.filter((row) => row.packId === pack), [rows, pack]);
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
      setNotice(null);
      try {
        await setPolicyEnabled(row.id, enabled);
      } catch {
        // Say so. The refetch below snaps the switch back to what the gateway actually holds,
        // and without a word for it that looks like the click simply missed.
        setNotice("toggleFailed");
      } finally {
        setPulse((previous) => previous + 1);
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
    setBusy(entry.id);
    setNotice(null);
    try {
      await setPackEnabled(entry.id, enabled);
    } catch {
      setNotice("toggleFailed");
    } finally {
      setBusy(null);
      setPulse((previous) => previous + 1);
    }
  }, []);

  if ((policies.loading || packsResource.loading) && !(policies.data && packsResource.data)) {
    return <p className="text-body-text-b3-md p-8 text-grayscale-400">{t("loading")}</p>;
  }

  if ((policies.error || packsResource.error) && !(policies.data && packsResource.data)) {
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
      {notice && (
        <p
          role="status"
          className="text-body-text-b3-md flex items-center gap-2 bg-grayscale-700 px-8 py-3 text-grayscale-white"
        >
          <Info className="size-4 flex-none" aria-hidden />
          {t(notice)}
        </p>
      )}
      {/*
        Three frames, three layouts. 1280 and 1920 are real columns — 232 / flexible / 347, and
        at 1920 the YAML pane widens to 560. At 1024 the design floats that pane *over* the
        table's right edge instead of taking a third of a column that is already too narrow, so
        below `xl` it is positioned out of flow and the grid carries two columns.
      */}
      <div className="relative grid flex-1 grid-cols-1 gap-px bg-grayscale-800 lg:grid-cols-[232px_minmax(0,1fr)] xl:grid-cols-[232px_minmax(0,1fr)_347px] 2xl:grid-cols-[232px_minmax(0,1fr)_560px]">
        <div className="bg-grayscale-950 px-4 py-6">
          <PackTree
            packs={packs}
            counts={counts}
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
        {/* Out of flow below `xl`, where it floats over the table as the 1024 frame draws it. */}
        <div className="absolute inset-y-4 right-4 w-86.75 overflow-y-auto rounded-(--primitive-radius-rounded-2xl) bg-grayscale-950 px-6 py-6 ring-1 shadow-xl shadow-black/40 ring-grayscale-800 xl:static xl:w-auto xl:overflow-visible xl:rounded-none xl:shadow-none xl:ring-0">
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
