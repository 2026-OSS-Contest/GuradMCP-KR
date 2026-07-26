"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ComponentType, SVGProps } from "react";
import type { Overview } from "@/lib/api/types";
import { KpiBlockedIcon, KpiPoliciesIcon, KpiServersIcon, KpiToolsIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/** Where the inventory panel anchors the two counts that scroll rather than navigate. */
export const INVENTORY_ANCHOR = "server-inventory";

/** Stands in for a number that was never fetched, so the cards keep their shape. */
const UNKNOWN = "—";

interface Card {
  key: string;
  href: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  value: number | string;
  /** Small caption beside the number; omitted when there is nothing to say. */
  note?: string;
  noteTone?: string;
  danger?: boolean;
}

export function KpiCards({ overview, failed }: { overview: Overview | undefined; failed: boolean }) {
  const t = useTranslations("gateway.kpi");

  if (!overview && !failed) {
    return (
      <div className="flex gap-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-[130px] flex-1 animate-pulse motion-reduce:animate-none rounded-sm bg-grayscale-900" />
        ))}
      </div>
    );
  }

  const cards: Card[] = [
    {
      key: "servers",
      href: `#${INVENTORY_ANCHOR}`,
      Icon: KpiServersIcon,
      value: overview?.servers.total ?? UNKNOWN,
      note:
        overview && overview.servers.disconnected > 0
          ? t("serversDown", { count: overview.servers.disconnected })
          : undefined,
      noteTone: "text-verdict-warn"
    },
    { key: "tools", href: `#${INVENTORY_ANCHOR}`, Icon: KpiToolsIcon, value: overview?.protectedTools ?? UNKNOWN },
    {
      key: "policies",
      href: "/policies",
      Icon: KpiPoliciesIcon,
      value: overview?.policies.active ?? UNKNOWN,
      note: overview ? t("packCount", { count: overview.policies.packs.length }) : undefined,
      noteTone: "text-(--primitive-opacity-white-alpha-50)"
    },
    {
      key: "blocked",
      href: "/replay?verdict=block",
      Icon: KpiBlockedIcon,
      value: overview?.blocked24h ?? UNKNOWN,
      danger: true
    }
  ];

  return (
    <div className="flex gap-4">
      {cards.map(({ key, href, Icon, value, note, noteTone, danger }) => (
        <Link
          key={key}
          href={href}
          className={cn(
            // The panel's 1px stroke sits inside its 130px height in Figma, so it is an inset
            // ring here; a border would push the card to 132.
            "flex flex-1 flex-col gap-2 rounded-sm p-4 transition-colors",
            danger
              ? "bg-(--primitive-opacity-block-alpha-6) shadow-[inset_0_0_0_1px_var(--primitive-opacity-block-alpha-25)] hover:bg-(--primitive-opacity-block-alpha-10)"
              : "bg-grayscale-900 shadow-[inset_0_0_0_1px_var(--primitive-color-grayscale-800)] hover:bg-grayscale-800"
          )}
        >
          <span className="flex h-10 items-center gap-3">
            <Icon className="size-10 flex-none" aria-hidden />
            <span className="text-body-text-b3-md text-grayscale-300">{t(key)}</span>
          </span>

          <span className="flex h-[50px] items-end justify-end gap-2">
            <b className={cn("text-header-text-h-bd", danger ? "text-red-400" : "text-grayscale-white")}>{value}</b>
            {note && <span className={cn("py-2 text-caption-text-c-md", noteTone)}>{note}</span>}
          </span>
        </Link>
      ))}
    </div>
  );
}
