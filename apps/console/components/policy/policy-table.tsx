"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { PolicyAction, PolicyRow, PolicySeverity, Verdict } from "@/lib/api/types";
import { Tag } from "@/components/ui/tag";
import { Switch } from "@/components/ui/switch";
import { VerdictBadge } from "@/components/verdict-badge";
import { cn } from "@/lib/utils";

/**
 * The DSL has one more action than the UI has verdicts: `mask_then_allow` and `warn` both read
 * as 경고. `lib/verdict.ts` covers the control plane's narrower `GuardAction`, so the extra case
 * is handled here rather than widening that mapping for a vocabulary only this screen sees.
 */
const VERDICT_OF: Record<PolicyAction, Verdict> = {
  allow: "allow",
  mask_then_allow: "warn",
  warn: "warn",
  require_approval: "require_approval",
  block: "block"
};

/** Severity ink, straight off the design's text fills. `info` has no frame, so it reads muted. */
const SEVERITY_INK: Record<PolicySeverity, string> = {
  info: "text-grayscale-300",
  low: "text-green-700",
  medium: "text-blue-600",
  high: "text-yellow-500",
  critical: "text-red-500"
};

export interface PolicyTableProps {
  policies: PolicyRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  onToggle: (policy: PolicyRow, enabled: boolean) => void;
  /** Policy whose toggle is mid-flight. */
  busy?: string | null;
}

export function PolicyTable({ policies, selected, onSelect, onToggle, busy }: PolicyTableProps) {
  const t = useTranslations("policies");

  return (
    <section aria-labelledby="policy-table-title" className="flex min-w-0 flex-col gap-4">
      <h2 id="policy-table-title" className="text-body-text-b3-md text-grayscale-300">
        {t("table.title")}
      </h2>
      {/*
        The design fixes ID at 78px and PRI at 54px and lets the remaining four columns split
        what is left equally — which `table-fixed` does for any column given no width. Header
        labels clip rather than wrap, exactly as the 1280 frame draws them.
      */}
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-19.5" />
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
            const muted = !policy.enabled;
            return (
              <tr
                key={policy.id}
                onClick={() => onSelect(policy.id)}
                aria-selected={selected === policy.id}
                className={cn(
                  "cursor-pointer border-b border-grayscale-800 align-middle",
                  selected === policy.id && "bg-grayscale-800",
                  muted && "text-grayscale-500"
                )}
              >
                {/* 78px cannot hold a policy id, and the design clamps rather than reflowing
                    the row: two lines, then an ellipsis. The full id stays in the title. */}
                <td className="text-body-mono-b3-rg py-4 pr-2">
                  <span className="line-clamp-2 break-all" title={policy.id}>
                    {policy.id}
                  </span>
                </td>
                <td className="text-body-text-b2-md py-4 pr-2 tabular-nums">{policy.priority}</td>
                <td className="py-4 pr-2 whitespace-nowrap">
                  {policy.dryRun ? (
                    <Tag className="text-caption-text-c-md">{t("table.dryRun")}</Tag>
                  ) : (
                    <VerdictBadge verdict={VERDICT_OF[policy.action]} size="sm" compact />
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
                      checked={policy.enabled}
                      disabled={busy === policy.id}
                      onChange={(next) => onToggle(policy, next)}
                      label={t("table.toggle", { id: policy.id })}
                    />
                  </span>
                </td>
                <td className="text-body-text-b2-md py-4 tabular-nums">
                  {policy.firedLast30d === null ? (
                    <span className="text-grayscale-300">–</span>
                  ) : (
                    // Straight to the sessions this policy decided. Replay does not read the
                    // filter yet — same as the SCR-101 KPI cards' `?verdict=` links.
                    <Link
                      href={`/replay?policy=${encodeURIComponent(policy.id)}`}
                      onClick={(event) => event.stopPropagation()}
                      className="underline-offset-4 hover:underline"
                    >
                      {policy.firedLast30d}
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
