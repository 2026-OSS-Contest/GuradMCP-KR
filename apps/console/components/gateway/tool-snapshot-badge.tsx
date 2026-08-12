"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { acknowledgeToolDiff, getToolDiffs } from "@/lib/api/client";
import { RESOURCE_REFRESH_EVENT } from "@/lib/api/use-resource";
import type { ToolDefinitionDiff, ToolDiffSide, ToolDiffType } from "@/lib/api/types";
import { SnapshotChangedIcon } from "@/components/icons";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

const DIFF_LABEL_KEY: Record<ToolDiffType, string> = {
  tool_added: "toolAdded",
  tool_removed: "toolRemoved",
  description_changed: "descriptionChanged",
  schema_changed: "schemaChanged",
};

/**
 * One before/after field. `description` renders as prose; `inputSchema` (schema_changed only)
 * as pretty-printed JSON — the field(s) actually present is what distinguishes diff types, not
 * a fixed layout per type.
 */
function DiffSide({ side, none }: { side: ToolDiffSide | null; none: string }) {
  if (!side) return <span className="text-(--primitive-opacity-white-alpha-50)">{none}</span>;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {side.description !== undefined && <p className="break-words">{side.description}</p>}
      {side.inputSchema !== undefined && (
        <pre className="whitespace-pre-wrap break-all font-mono">{JSON.stringify(side.inputSchema, null, 2)}</pre>
      )}
    </div>
  );
}

/**
 * Reuses `MaskDiffView`'s before(red)-over-after(green) two-column shell
 * (`components/replay/mask-diff.tsx`) — same container classes, same `−`/`→` markers — but the
 * highlighted content is the changed `description`/`inputSchema` fields, not a masking span
 * (spec §7: "강조 대상은 마스킹 span이 아니라 변경된 description/inputSchema 필드로 대체").
 */
function DiffCard({
  diff,
  pending,
  onAcknowledge,
}: {
  diff: ToolDefinitionDiff;
  pending: boolean;
  onAcknowledge: () => void;
}) {
  const t = useTranslations("gateway.inventory.diffPopover");
  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption-text-c-md text-grayscale-100">{t(DIFF_LABEL_KEY[diff.diffType])}</p>
      <div className="flex flex-col gap-0 rounded-lg bg-(--primitive-opacity-black-alpha-75) p-2 text-caption-mono-c-rg">
        <div className="flex items-start gap-2 rounded-t-sm bg-(--primitive-opacity-block-alpha-10) p-2">
          <span className="flex-none pt-0.5 text-red-300" aria-hidden>
            −
          </span>
          <div className="min-w-0 flex-1 text-red-300">
            <p className="pb-1 text-(--primitive-opacity-white-alpha-75)">{t("before")}</p>
            <DiffSide side={diff.before} none={t("none")} />
          </div>
        </div>
        <div className="flex items-start gap-2 rounded-b-sm bg-(--primitive-opacity-allow-alpha-10) p-2">
          <span className="flex-none pt-0.5 text-green-500" aria-hidden>
            →
          </span>
          <div className="min-w-0 flex-1 text-green-500">
            <p className="pb-1 text-(--primitive-opacity-white-alpha-75)">{t("after")}</p>
            <DiffSide side={diff.after} none={t("none")} />
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onAcknowledge}
          disabled={pending}
          className="flex h-8 items-center rounded-lg bg-(--primitive-opacity-white-alpha-6) px-3 text-caption-text-c-md transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          {pending ? t("acknowledging") : t("acknowledge")}
        </button>
      </div>
    </div>
  );
}

/**
 * SCR-101 "정의 변경 감지" badge + diff popover (FR-GW-03 §7). Shown only when
 * `snapshotStatus.state === "drift_detected"` (checked by the caller). Clicking fetches
 * `GET /servers/{serverId}/tools/{toolName}/diffs` (§6.2); "확인" resolves one diff via §6.3
 * without touching the approved baseline.
 */
export function ToolSnapshotBadge({ serverId, toolName }: { serverId: string; toolName: string }) {
  const t = useTranslations("gateway.inventory");
  const tp = useTranslations("gateway.inventory.diffPopover");
  const [open, setOpen] = useState(false);
  const [diffs, setDiffs] = useState<ToolDefinitionDiff[] | null>(null);
  const [error, setError] = useState(false);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError(false);
    getToolDiffs(serverId, toolName, controller.signal)
      .then((response) => setDiffs(response.diffs))
      .catch(() => setError(true));
    return () => controller.abort();
  }, [open, serverId, toolName]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  const acknowledge = async (diffId: string) => {
    setAcknowledging(diffId);
    try {
      await acknowledgeToolDiff(serverId, toolName, diffId);
      setDiffs((current) => current?.filter((diff) => diff.id !== diffId) ?? current);
      // The badge itself lives on the /servers-fed inventory row; refresh that resource so it
      // drops once this was the last pending diff, without waiting out the poll interval.
      window.dispatchEvent(new Event(RESOURCE_REFRESH_EVENT));
    } catch {
      // Left in the list — the operator sees it is still there and can retry.
    } finally {
      setAcknowledging(null);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="transition-opacity hover:opacity-80">
        <Tag tone="alert" shape="pill" className="text-caption-text-c-md">
          <SnapshotChangedIcon className="size-4 flex-none" aria-hidden />
          {t("snapshotChanged")}
        </Tag>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={tp("title")}
          className={cn(
            "absolute right-0 top-full z-20 mt-2 w-[360px] max-w-[90vw] rounded-lg bg-grayscale-900 p-3",
            "shadow-xl shadow-black/50 shadow-[inset_0_0_0_1px_var(--primitive-color-grayscale-700)]",
          )}
        >
          <div className="flex items-center justify-between pb-2">
            <h3 className="text-body-text-b3-md text-grayscale-white">{tp("title")}</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={tp("close")}
              className="text-body-text-b3-rg text-grayscale-100 transition-colors hover:text-grayscale-white"
            >
              ✕
            </button>
          </div>

          {error ? (
            <p className="text-body-text-b3-rg text-grayscale-100">{tp("loadError")}</p>
          ) : diffs === null ? (
            <p className="text-body-text-b3-rg text-grayscale-100">{tp("loading")}</p>
          ) : diffs.length === 0 ? (
            <p className="text-body-text-b3-rg text-grayscale-100">{tp("empty")}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {diffs.map((diff) => (
                <DiffCard
                  key={diff.id}
                  diff={diff}
                  pending={acknowledging === diff.id}
                  onAcknowledge={() => void acknowledge(diff.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
