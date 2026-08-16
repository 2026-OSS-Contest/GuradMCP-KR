"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ComponentType, SVGProps } from "react";
import type { McpServer, RiskLevel, ToolEntry, TrustLevel } from "@/lib/api/types";
import {
  AccordionClosedIcon,
  AccordionClosedMutedIcon,
  AccordionOpenIcon,
  ConnectedDotIcon,
  DisconnectedDotIcon,
  RiskHighIcon,
  RiskLowIcon,
  RiskMediumIcon
} from "@/components/icons";
import { Tag, type TagTone } from "@/components/ui/tag";
import { ToolSnapshotBadge } from "./tool-snapshot-badge";
import { INVENTORY_ANCHOR } from "./kpi-cards";
import { cn } from "@/lib/utils";

const TRUST: Record<TrustLevel, TagTone> = { trusted: "trusted", limited: "limited", untrusted: "untrusted" };

const RISK: Record<RiskLevel, { Icon: ComponentType<SVGProps<SVGSVGElement>>; tone: string; key: string }> = {
  high: { Icon: RiskHighIcon, tone: "text-verdict-block", key: "riskHigh" },
  medium: { Icon: RiskMediumIcon, tone: "text-verdict-warn", key: "riskMedium" },
  low: { Icon: RiskLowIcon, tone: "text-verdict-allow", key: "riskLow" }
};

/**
 * The design fixes the policy column and lets the tool and risk columns share what is left,
 * widening it once at each breakpoint it was drawn at: 200 / 318 / 481.
 *
 * A basis rather than a width, and shrinkable: the design was never drawn below 1024, and at a
 * width where 200px no longer leaves room the fixed column took everything and squeezed the tool
 * name to nothing. As a basis it holds those exact numbers wherever they fit and gives ground
 * only once they do not.
 */
const POLICY_COLUMN = "basis-[200px] xl:basis-[318px] min-[1920px]:basis-[481px]";

function ToolRow({ serverId, tool }: { serverId: string; tool: ToolEntry }) {
  const t = useTranslations("gateway.inventory");
  const { Icon: RiskIcon, tone, key } = RISK[tool.risk];
  const [first, ...rest] = tool.policies;

  return (
    // The row rule is a bottom-only stroke drawn inside the 45px height. The height is a floor
    // rather than a fixed size: the policy column keeps its width at every breakpoint, so below
    // the narrowest one the two flexible columns are squeezed to nothing and the tool name
    // disappears entirely. Letting the row grow is what keeps it readable there.
    <div className="flex min-h-[45px] items-center bg-(--primitive-opacity-black-alpha-25) shadow-[inset_0_-1px_0_0_var(--primitive-opacity-white-alpha-10)]">
      <div className="flex min-w-0 flex-1 items-center justify-center p-3">
        {/* A tool name is one unbroken token, so it has to be allowed to break mid-word — and
            then held to two lines, past which it is the policy and the risk that matter more. */}
        <code className="line-clamp-2 w-full break-all text-body-mono-b3-rg">{tool.name}</code>
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center p-3">
        {/* Icon, label and grade wrap independently, so the column reads down the three of them
            instead of clipping the grade off the end. */}
        <span className={cn("flex flex-wrap items-center gap-x-1 text-body-text-b3-md", tone)}>
          <RiskIcon className="h-5 w-4 flex-none" aria-hidden />
          <span>{t("risk")}</span>
          <span>{t(key)}</span>
        </span>
      </div>

      <div className={cn("flex min-w-0 grow-0 flex-wrap items-center gap-x-3 gap-y-1 p-3", POLICY_COLUMN)}>
        {first ? (
            // flex, so the anchor hugs the tag: as an inline box it takes the row's line-height
            // instead, which is 4px taller than the tag and pushed the whole row past its 45px.
            <Link href={`/policies/${first}`} className="flex min-w-0 transition-opacity hover:opacity-80">
            <Tag className="max-w-full text-caption-mono-c-rg">
              <span className="truncate">{first}</span>
            </Tag>
          </Link>
        ) : (
          <span className="truncate text-body-text-b3-rg text-grayscale-100">{t("noPolicies")}</span>
        )}

        {rest.length > 0 && (
          <span className="flex-none text-body-text-b3-rg text-grayscale-100">
            {t("morePolicies", { count: rest.length })}
          </span>
        )}

        {(tool.snapshotStatus.state === "drift_detected" || tool.snapshotStatus.state === "drift_acknowledged") && (
          // FR-GW-03 §7 — the definition drifted from the one approved at first sight, and
          // (drift_acknowledged) dismissing the notice never moved the baseline, so it's
          // still true. Click opens the before/after diff popover (§6.2/§6.3).
          <ToolSnapshotBadge serverId={serverId} toolName={tool.name} state={tool.snapshotStatus.state} />
        )}
      </div>
    </div>
  );
}

function ServerAccordion({ server, defaultOpen }: { server: McpServer; defaultOpen: boolean }) {
  const t = useTranslations("gateway.inventory");
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `inventory-tools-${server.id}`;

  const Chevron = open ? AccordionOpenIcon : server.connected ? AccordionClosedIcon : AccordionClosedMutedIcon;
  const DotIcon = server.connected ? ConnectedDotIcon : DisconnectedDotIcon;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          "flex h-10 w-full items-center gap-3 px-3 py-2 text-left transition-colors",
          open
            ? "bg-(--primitive-opacity-blue-alpha-50)"
            : "bg-(--primitive-opacity-blue-alpha-25) hover:bg-(--primitive-opacity-blue-alpha-50)"
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex min-w-0 items-center gap-3">
            <Chevron className="size-6 flex-none" aria-hidden />
            <span
              className={cn(
                "truncate text-body-mono-b2-bd",
                server.connected ? "text-grayscale-white" : "text-(--primitive-opacity-white-alpha-50)"
              )}
            >
              {server.name}
            </span>
          </span>

          <span
            className={cn(
              "flex flex-none items-center gap-1 text-body-text-b3-md",
              server.connected ? "text-green-500" : "text-(--primitive-opacity-white-alpha-50)"
            )}
          >
            <DotIcon className="size-4 flex-none" aria-hidden />
            {t(server.connected ? "connected" : "disconnected")}
          </span>

          <Tag tone={TRUST[server.trust]} className="text-caption-text-c-md">
            {server.trust}
          </Tag>
        </span>

        <span className="flex flex-none items-center gap-1 text-caption-text-c-rg text-(--primitive-opacity-white-alpha-75)">
          <span>Tool</span>
          <span>{server.tools.length}</span>
        </span>
      </button>

      {open && (
        <div id={panelId}>
          {server.tools.map((tool) => (
            <ToolRow key={tool.name} serverId={server.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ServerInventory({
  servers,
  loading,
  failed
}: {
  servers: McpServer[];
  loading: boolean;
  /** Nothing has ever loaded and the last attempt failed — there is no stale data to show. */
  failed: boolean;
}) {
  const t = useTranslations("gateway.inventory");
  const tError = useTranslations("gateway.error");

  return (
    <section id={INVENTORY_ANCHOR} className="flex min-w-0 flex-1 flex-col gap-4 rounded-xl bg-grayscale-900 p-4">
      <h2 className="pb-3 text-body-text-b1-md text-grayscale-300 shadow-[inset_0_-1px_0_0_var(--primitive-opacity-white-alpha-10)]">
        {t("title")}
      </h2>

      {failed ? (
        <p className="text-body-text-b3-md text-grayscale-400">{tError("unreachable")}</p>
      ) : loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-10 animate-pulse motion-reduce:animate-none rounded-sm bg-(--primitive-opacity-white-alpha-6)" />
          ))}
        </div>
      ) : (
        // Scrolls within the panel rather than growing it: an expanded server runs to a dozen
        // tools. `p-3 -m-3`: see session-list — without it the scroll container clips the focus
        // ring on the accordion headers.
        <div className="-m-3 flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
          <div className="flex flex-col">
            {servers.map((server, index) => (
              <ServerAccordion key={server.id} server={server} defaultOpen={index === 0} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
