"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { PolicyRow, PolicyStats, Severity } from "@/lib/api/types";
import { Tag } from "@/components/ui/tag";
import { Switch } from "@/components/ui/switch";
import { VerdictBadge } from "@/components/verdict-badge";
import { toVerdict } from "@/lib/verdict";
import { cn } from "@/lib/utils";

/** Severity ink, straight off the design's text fills. */
// One step brighter than the palette's mid tones, because the selected row's `bg-grayscale-800`
// is the worst ground these sit on: green-700 measured 4.37:1 there, blue-600 4.49:1 and red-500
// 4.05:1, all under the 4.5:1 AA floor (NFR-08). Yellow already cleared it and is left alone.
const SEVERITY_INK: Record<Severity, string> = {
  low: "text-green-600",
  medium: "text-blue-500",
  high: "text-yellow-500",
  critical: "text-red-400"
};

export interface PolicyTableProps {
  policies: PolicyRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  onToggle: (policy: PolicyRow, enabled: boolean) => void;
  /** Fired counts, keyed by policy id — `GET /policies/{policyId}/stats`, not part of the row. */
  stats: Record<string, PolicyStats>;
  /** Policy whose toggle is mid-flight. */
  busy?: string | null;
}

export function PolicyTable({ policies, selected, onSelect, onToggle, stats, busy }: PolicyTableProps) {
  const t = useTranslations("policies");

  return (
    <section aria-labelledby="policy-table-title" className="flex min-w-0 flex-col gap-4">
      <h2 id="policy-table-title" className="text-body-text-b3-md text-grayscale-300">
        {t("table.title")}
      </h2>
      {/*
        PRI is 54px in every frame and the remaining four columns always split what is left
        equally — which `table-fixed` does for any column given no width. ID is the one that
        moves: 132px at 1024, 78px at 1280 (where the YAML pane is beside the table rather than
        over it, so the table is at its narrowest), and 301px from 1920. Header labels clip
        rather than wrap, exactly as the frames draw them.
      */}
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-33 xl:w-19.5 2xl:w-75.25" />
          <col className="w-13.5" />
          <col />
          <col />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr className="text-body-text-b2-md border-b border-grayscale-800 text-left text-grayscale-300">
            <th scope="col" className="truncate py-3 pr-2 font-normal">
              {t("table.id")}
            </th>
            <th scope="col" className="truncate py-3 pr-2 font-normal">
              {t("table.priority")}
            </th>
            <th scope="col" className="truncate py-3 pr-2 font-normal">
              {t("table.action")}
            </th>
            <th scope="col" className="truncate py-3 pr-2 font-normal">
              {t("table.severity")}
            </th>
            <th scope="col" className="truncate py-3 pr-2 font-normal">
              {t("table.enabled")}
            </th>
            <th scope="col" className="truncate py-3 font-normal">
              {t("table.fired")}
            </th>
          </tr>
        </thead>
        <tbody>
          {policies.map((policy) => {
            // A dry-run policy is evaluated but acts on nothing, so the whole row reads muted —
            // the same treatment a disabled one gets.
            const fired = stats[policy.id]?.firedLast30d ?? null;
            // `enabled` is the console's own field: `PolicyUpdateRequest` has no such property,
            // so a control plane that omits it from the list cannot be told to change it either.
            // Showing a live switch there would take a click, answer 200 and change nothing.
            const controllable = policy.enabled !== undefined;
            const enabled = policy.enabled ?? true;
            const muted = !enabled;
            return (
              <tr
                key={policy.id}
                onClick={() => onSelect(policy.id)}
                // A row is a select target, so it has to be one for the keyboard too.
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onSelect(policy.id);
                }}
                aria-selected={selected === policy.id}
                className={cn(
                  "cursor-pointer border-b border-grayscale-800 align-middle",
                  selected === policy.id && "bg-grayscale-800",
                  muted && "text-grayscale-500"
                )}
              >
                {/* 78px cannot hold a policy id, and the design clamps rather than reflowing
                    the row: two lines, then an ellipsis. The full id stays in the title. */}
                <td className="text-body-mono-b2-rg py-4 pr-2">
                  <span className="line-clamp-2 break-all" title={policy.id}>
                    {policy.id}
                  </span>
                </td>
                <td className="text-body-text-b2-md py-4 pr-2 tabular-nums">{policy.priority}</td>
                <td className="py-4 pr-2 whitespace-nowrap">
                  {policy.dryRun ? (
                    <Tag className="text-caption-text-c-md">{t("table.dryRun")}</Tag>
                  ) : (
                    <VerdictBadge verdict={toVerdict(policy.action)} size="sm" compact />
                  )}
                </td>
                <td className={cn(
                    "text-body-text-b2-md py-4 pr-2",
                    muted ? "text-grayscale-500" : SEVERITY_INK[policy.severity]
                  )}>
                  {policy.severity}
                </td>
                <td className="py-4 pr-2">
                  {/* The row is a select target; the switch inside it must not also select. */}
                  <span onClick={(event) => event.stopPropagation()}>
                    <Switch
                      checked={enabled}
                      disabled={!controllable || busy === policy.id}
                      title={controllable ? undefined : t("table.toggleUnsupported")}
                      onChange={(next) => onToggle(policy, next)}
                      label={t("table.toggle", { id: policy.id })}
                    />
                  </span>
                </td>
                <td className="text-body-text-b2-md py-4 tabular-nums">
                  {fired === null ? (
                    <span className="text-grayscale-300">–</span>
                  ) : (
                    // Straight to the sessions this policy decided. Replay does not read the
                    // filter yet — same as the SCR-101 KPI cards' `?verdict=` links.
                    <Link
                      href={`/replay?policy=${encodeURIComponent(policy.id)}`}
                      onClick={(event) => event.stopPropagation()}
                      className="underline-offset-4 hover:underline"
                    >
                      {fired}
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
