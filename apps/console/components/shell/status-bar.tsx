"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { GatewayStatus } from "@/lib/api/types";
import { isOffline, useOverview } from "@/components/providers/overview-provider";
import { StatusDisconnectedIcon, StatusProtectedIcon } from "@/components/icons";
import { VerdictBadge } from "@/components/verdict-badge";
import { Tag } from "@/components/ui/tag";
import { SessionPicker } from "./session-picker";
import { usePendingApprovals } from "./use-pending-approvals";
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
  const pathname = usePathname();

  const status: GatewayStatus = isOffline(overview) ? "disconnected" : (overview.data?.status ?? "protected");
  const { Icon, label, text } = STATUS[status];
  const packs = overview.data?.policies.packs ?? [];
  // Nothing registered yet: SCR-101's empty frame keeps the bar's 60px ground and its rule and
  // draws nothing on it. Every item here reports on servers that do not exist — 보호 중 above all,
  // which would claim protection over nothing — so the bar carries no contents while the gateway
  // is asking for its first server. Only there: the other screens' empty frames keep the bar as
  // it is, and only once the poll has answered, since while it is loading there is no such claim
  // to make either way.
  const nothingRegistered =
    pathname === "/" && overview.data !== undefined && overview.data.servers.total === 0;
  // Seeded by the /overview poll, kept live by approval.created/resolved SSE events (spec §4.1).
  const pending = usePendingApprovals(overview.data?.pendingApprovals ?? 0, overview.requestedAt);

  return (
    <header className="flex h-15 flex-none items-center gap-4 bg-grayscale-950 px-8 shadow-[inset_0_-1px_0_0_var(--primitive-color-grayscale-800)]">
      {/* Centre every cluster on the bar's midline so the status text, policy chips and the
          session picker share one baseline (they are different heights).

          This replaces an earlier bottom-edge alignment: the session picker on the right is
          centred by the header itself, so aligning only the left cluster to the bottom left the
          two sides on different lines — measured at 1440, the left labels sat at cy 33.5 against
          the picker's 30. Centring the row puts every label on cy ≈ 29.5. Worth a designer's
          confirmation if the bottom edge was deliberate. */}
      {nothingRegistered ? null : (
      <div className="flex flex-1 items-center gap-3">
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
                  // inline-flex (not the default inline) so the mono chip centres on the row rather
                  // than riding a text line-box that left it 2px below the labels.
                  <Link key={pack} href="/policies" className="inline-flex items-center transition-opacity hover:opacity-80">
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
              // inline-flex (not the default inline) so the taller badge centres on the row instead
              // of riding an inline text line-box, which left its label 2px above 보호 중 / 정책 팩.
              className="inline-flex items-center transition-opacity hover:opacity-80"
            >
              <VerdictBadge verdict="require_approval" size="sm" count={pending} />
            </Link>
          </>
        )}
      </div>
      )}

      {nothingRegistered ? null : <SessionPicker />}
    </header>
  );
}
