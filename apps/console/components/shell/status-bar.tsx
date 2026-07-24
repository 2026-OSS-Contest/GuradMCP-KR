"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { GatewayStatus } from "@/lib/api/types";
import { isOffline, useOverview } from "@/components/providers/overview-provider";
import { DropdownChevronIcon, StatusDisconnectedIcon, StatusProtectedIcon } from "@/components/icons";
import { VerdictBadge } from "@/components/verdict-badge";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

/**
 * SCR-000 status bar, driven by the shared `/overview` poll.
 *
 * Colour is always paired with text (spec §4.1 no.3). The indicator dot is the design's own
 * vector, which carries the halo and the fill together.
 */
const STATUS = {
  protected: { Icon: StatusProtectedIcon, label: "protected", text: "text-verdict-allow" },
  degraded: { Icon: StatusProtectedIcon, label: "degraded", text: "text-verdict-warn" },
  disconnected: { Icon: StatusDisconnectedIcon, label: "disconnected", text: "text-verdict-block" }
} as const;

const Divider = () => <span className="h-5 w-px flex-none bg-(--primitive-opacity-white-alpha-25)" aria-hidden />;

export function StatusBar() {
  const t = useTranslations("shell");
  const overview = useOverview();

  const status: GatewayStatus = isOffline(overview) ? "disconnected" : (overview.data?.status ?? "protected");
  const { Icon, label, text } = STATUS[status];
  const packs = overview.data?.policies.packs ?? [];
  const pending = overview.data?.pendingApprovals ?? 0;

  return (
    <header className="flex h-15 flex-none items-center gap-4 bg-grayscale-950 px-8 shadow-[inset_0_-1px_0_0_var(--primitive-color-grayscale-800)]">
      {/* The design aligns this row to its bottom edge, not its centre. */}
      <div className="flex flex-1 items-end gap-3 py-2">
        <span className={cn("flex flex-none items-center gap-2 text-body-text-b3-md", text)}>
          <Icon className="size-5 flex-none" aria-hidden />
          {t(label)}
        </span>

        {packs.length > 0 && (
          <>
            <Divider />
            <span className="flex items-center gap-3">
              <span className="text-body-text-b3-md text-grayscale-300">{t("policyPacks")}</span>
              <span className="flex items-center gap-2">
                {packs.map((pack) => (
                  <Link key={pack} href="/policies" className="transition-opacity hover:opacity-80">
                    <Tag className="text-caption-mono-c-rg">{pack}</Tag>
                  </Link>
                ))}
              </span>
            </span>
          </>
        )}

        {pending > 0 && (
          <>
            <Divider />
            <Link
              href="/approvals"
              aria-label={`${t("pendingApprovals")} ${pending}`}
              className="transition-opacity hover:opacity-80"
            >
              <VerdictBadge verdict="require_approval" size="sm" count={pending} />
            </Link>
          </>
        )}
      </div>

      {/* Session picker is inert until `GET /sessions` exists (spec §6.2). */}
      <button
        type="button"
        className="flex h-8 flex-none items-center gap-2 rounded-sm bg-(--primitive-opacity-white-alpha-6) py-1 pr-1 pl-3 transition-colors hover:bg-white/10"
      >
        <span className="text-body-text-b3-md text-grayscale-200">{t("session")}</span>
        <span className="text-body-text-b3-md">#s-0712</span>
        <DropdownChevronIcon className="size-6 flex-none" aria-hidden />
      </button>
    </header>
  );
}
