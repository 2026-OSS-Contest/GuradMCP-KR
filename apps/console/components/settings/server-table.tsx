"use client";

import { useTranslations } from "next-intl";
import { TagOfflineIcon, TagOkIcon, TagWarningIcon } from "@/components/icons";
import type { McpServer, TrustLevel } from "@/lib/api/types";
import { Select } from "@/components/ui/select";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

const TRUST_LEVELS: readonly TrustLevel[] = ["trusted", "limited", "untrusted"];

// Which changes need confirming is the gateway's call, not this table's: FR-GW-02 answers an
// upgrade with 409 and the policies it would drop. `TRUST_RANK` in lib/api/types mirrors the
// server's ordering for anything that needs to read it.

/** The select's ink follows the tier, straight off the design's text fills. */
const TRUST_INK: Record<TrustLevel, string> = {
  trusted: "text-green-500",
  limited: "text-yellow-400",
  untrusted: "text-red-300"
};

/**
 * SCR-501's upstream table. Read-only in the MVP except the trust tier — the endpoints and the
 * snapshot state are what the gateway found, not something the console sets.
 */
export interface ServerTableProps {
  servers: McpServer[];
  onTrustChange: (server: McpServer, trust: TrustLevel) => void;
  /** Server whose write is mid-flight; its select is inert until the request settles. */
  busy?: string | null;
}

export function ServerTable({ servers, onTrustChange, busy }: ServerTableProps) {
  const t = useTranslations("settings");

  return (
    <section aria-labelledby="servers-title" className="flex flex-col gap-4">
      <h2 id="servers-title" className="text-body-text-b3-md text-grayscale-300">
        {t("servers.title")}
      </h2>
      <div className="rounded-(--primitive-radius-rounded-xl) bg-grayscale-900 p-3">
        {/* Four equal columns at every width, as the frames have them — 222px each at 1280,
            382 at 1920, 158 at 1024. */}
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="text-body-text-b2-md bg-(--primitive-opacity-white-alpha-6) text-left text-grayscale-300">
              <th scope="col" className="[font-weight:inherit] w-1/4 rounded-l-lg px-4 py-3">
                {t("servers.name")}
              </th>
              <th scope="col" className="[font-weight:inherit] w-1/4 px-4 py-3">
                {t("servers.endpoint")}
              </th>
              <th scope="col" className="[font-weight:inherit] w-1/4 px-4 py-3">
                {t("servers.trust")}
              </th>
              <th scope="col" className="[font-weight:inherit] w-1/4 rounded-r-lg px-4 py-3">
                {t("servers.snapshot")}
              </th>
            </tr>
          </thead>
          <tbody>
            {servers.map((server) => {
              // `drift_acknowledged` counts too: acknowledging a diff (§6.3) deliberately never
              // touches the baseline, so that tool is still running on a definition the
              // approved snapshot doesn't cover — reporting 정상 here would hide exactly the
              // false-positive-pending-reapproval case the badge/popover exists to surface.
              const changed = server.tools.filter(
                (tool) => tool.snapshotStatus.state === "drift_detected" || tool.snapshotStatus.state === "drift_acknowledged",
              ).length;
              return (
                <tr key={server.id} className="border-b border-grayscale-800 last:border-0">
                  <td className="text-body-mono-b2-rg px-4 py-4 break-all text-grayscale-white">{server.name}</td>
                  <td className="text-body-mono-b2-rg px-4 py-4 break-all text-grayscale-300">
                    {server.endpoint ?? "–"}
                  </td>
                  <td className="px-4 py-4">
                    <Select
                      id={`trust-${server.id}`}
                      value={server.trust}
                      disabled={busy === server.id}
                      label={t("servers.trustOf", { name: server.name })}
                      onChange={(next) => onTrustChange(server, next as TrustLevel)}
                      className={cn("text-body-text-b3-md h-6 w-33", TRUST_INK[server.trust])}
                    >
                      {TRUST_LEVELS.map((level) => (
                        <option key={level} value={level} className="bg-grayscale-800 text-grayscale-white">
                          {level}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-4 py-4">
                    {/* A disconnected server reports nothing, so its snapshot state is unknown
                        rather than clean — the design greys it out instead of showing 정상. */}
                    {!server.connected ? (
                      // grayscale-400 rather than white-alpha-50: over the Tag's own
                      // `bg-grayscale-800` the 50% white measured 4.49:1, a hair under AA.
                      <Tag className="text-caption-text-c-md text-grayscale-400">
                        <TagOfflineIcon aria-hidden className="size-4" />
                        {t("servers.disconnected")}
                      </Tag>
                    ) : changed > 0 ? (
                      <Tag tone="limited" className="text-caption-text-c-md">
                        <TagWarningIcon aria-hidden className="size-4" />
                        {t("servers.snapshotChanged", { count: changed })}
                      </Tag>
                    ) : (
                      <Tag tone="trusted" className="text-caption-text-c-md">
                        <TagOkIcon aria-hidden className="size-4" />
                        {t("servers.snapshotClean")}
                      </Tag>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
