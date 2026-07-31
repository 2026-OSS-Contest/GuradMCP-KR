"use client";

import { useTranslations } from "next-intl";
import type { Approval, ApprovalStatus } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/** Local rather than shared: PR #61 introduces `lib/time.ts`, and duplicating the file here
 *  would collide with it. Folded into that helper once the shell branch lands. */
function hhmmss(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const DECISION: Partial<Record<ApprovalStatus, { key: string; tone: string }>> = {
  approved: { key: "approve", tone: "bg-grayscale-700 text-grayscale-white" },
  approved_masked: { key: "approveMasked", tone: "bg-blue-800 text-grayscale-white" },
  blocked: { key: "block", tone: "bg-red-700 text-grayscale-white" },
  expired: { key: "expired", tone: "bg-(--primitive-opacity-block-alpha-10) text-verdict-block" }
};

/** How long the operator took, which is what the last column reports. */
function tookSeconds(approval: Approval): string {
  if (!approval.decidedAt) return "–";
  return `${Math.round((Date.parse(approval.decidedAt) - Date.parse(approval.requestedAt)) / 1000)}s`;
}

/** 처리 이력 (spec §5.6): what was decided, by whom, and how long it took. */
export function ApprovalHistory({ approvals }: { approvals: Approval[] }) {
  const t = useTranslations("approval");

  if (approvals.length === 0) {
    return (
      <p role="status" className="py-16 text-center text-body-text-b3-md text-grayscale-400">
        {t("historyEmpty")}
      </p>
    );
  }

  return (
    <table className="w-full table-fixed border-collapse">
      <thead>
        <tr className="bg-(--primitive-opacity-white-alpha-6) text-left text-body-text-b3-md text-grayscale-300">
          <th scope="col" className="w-28 rounded-l-md px-4 py-3 font-normal">{t("colTime")}</th>
          <th scope="col" className="px-4 py-3 font-normal">{t("colTool")}</th>
          <th scope="col" className="w-48 px-4 py-3 font-normal">{t("colDecision")}</th>
          <th scope="col" className="w-44 px-4 py-3 font-normal">{t("colDecidedBy")}</th>
          <th scope="col" className="w-28 rounded-r-md px-4 py-3 font-normal">{t("colTook")}</th>
        </tr>
      </thead>
      <tbody>
        {approvals.map((approval) => {
          const decision = DECISION[approval.status];
          return (
            <tr key={approval.id} className="shadow-[inset_0_-1px_0_0_var(--primitive-opacity-white-alpha-10)]">
              <td className="px-4 py-3 text-caption-text-c-rg text-(--primitive-opacity-white-alpha-75)">
                {hhmmss(approval.decidedAt ?? approval.requestedAt)}
              </td>
              <td className="truncate px-4 py-3 font-mono text-body-mono-b2-rg text-grayscale-white">
                {approval.toolName}
              </td>
              <td className="px-4 py-3">
                {decision && (
                  <span className={cn("inline-flex rounded-md px-2 py-1 text-caption-text-c-rg", decision.tone)}>
                    {t(decision.key)}
                  </span>
                )}
              </td>
              <td className="truncate px-4 py-3 text-body-text-b2-md text-grayscale-200">
                {approval.decidedBy ?? "–"}
              </td>
              <td className="px-4 py-3 text-body-text-b2-md text-grayscale-white">{tookSeconds(approval)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
