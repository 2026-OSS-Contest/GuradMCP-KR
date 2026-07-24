"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import type { EventDetail } from "@/lib/api/types";
import { VerdictBadge } from "@/components/verdict-badge";
import { VerdictAllowIcon, VerdictWarnIcon } from "@/components/icons";
import { PolicyChip } from "./policy-chip";
import { MaskDiffView } from "./mask-diff";
import { cn } from "@/lib/utils";

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** 위협 점수 / 탐지 count panels. */
function StatPanel({ label, value, suffix, danger }: { label: string; value: number | string; suffix?: string; danger?: boolean }) {
  return (
    <div className="flex flex-1 flex-col gap-2 rounded-sm bg-grayscale-900 px-3 py-2 shadow-[inset_0_0_0_1px_var(--primitive-color-grayscale-800)]">
      <span className="text-body-text-b3-md text-grayscale-300">{label}</span>
      <span className="flex items-end justify-end gap-1">
        <b className={cn("text-header-text-h-bd", danger ? "text-red-400" : "text-grayscale-white")}>{value}</b>
        {suffix && <span className="pb-2 text-caption-text-c-md text-(--primitive-opacity-white-alpha-50)">{suffix}</span>}
      </span>
    </div>
  );
}

/** Chain Status Pill (spec §5.3 no.4⑤): verified is green, a hash-chain mismatch turns it yellow. */
function ChainPill({ status, hash }: EventDetail["chain"]) {
  const t = useTranslations("replay.detail");
  const verified = status === "verified";
  const Icon = verified ? VerdictAllowIcon : VerdictWarnIcon;
  return (
    <span
      className={cn(
        "inline-flex flex-none items-center gap-2 rounded-full px-2 py-1",
        verified
          ? "bg-(--primitive-opacity-allow-alpha-10) text-green-500 shadow-[inset_0_0_0_1px_var(--primitive-opacity-allow-alpha-10)]"
          : "bg-(--primitive-opacity-warn-alpha-10) text-yellow-400 shadow-[inset_0_0_0_1px_var(--primitive-opacity-warn-alpha-10)]"
      )}
    >
      <Icon className="h-5 w-4 flex-none" aria-hidden />
      <span className="text-body-text-b3-md">{verified ? t("chainVerified") : t("chainFailed")}</span>
      {verified && <span className="font-mono text-caption-mono-c-rg text-(--primitive-opacity-white-alpha-75)">#{hash}</span>}
    </span>
  );
}

function RevealModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const t = useTranslations("replay.reveal");

  // Focus trap-lite: Escape cancels.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onCancel}>
      <div
        role="alertdialog"
        aria-labelledby="reveal-title"
        aria-describedby="reveal-body"
        className="w-96 max-w-full rounded-lg bg-grayscale-900 p-6 shadow-xl shadow-black/50"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="reveal-title" className="text-body-text-b1-bd text-grayscale-white">
          {t("title")}
        </h2>
        <p id="reveal-body" className="mt-2 text-body-text-b3-md text-grayscale-300">
          {t("body")}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-9 items-center rounded-lg bg-(--primitive-opacity-white-alpha-6) px-4 text-body-text-b3-md transition-colors hover:bg-white/10"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex h-9 items-center rounded-lg bg-blue-800 px-4 text-body-text-b3-md transition-colors hover:bg-blue-700"
          >
            {t("continue")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * SCR-301 event detail panel (spec §5.3 no.4), fixed order: Verdict Badge → matching policies →
 * threat/detection → detection list → Mask Diff → Chain Status Pill, with the reveal-original
 * action pinned to the bottom. Sections with no data (a non-block event) fold away.
 */
export function EventDetailPanel({ detail }: { detail: EventDetail }) {
  const t = useTranslations("replay.detail");
  const [maskExpanded, setMaskExpanded] = useState(false);
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="flex h-full flex-col justify-between gap-4 px-4 py-6">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <header className="flex flex-col gap-3 pb-3 shadow-[inset_0_-1px_0_0_var(--primitive-opacity-white-alpha-10)]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-body-text-b3-md text-grayscale-300">{t("title")}</span>
            <time className="flex-none text-caption-text-c-rg text-(--primitive-opacity-white-alpha-50)" dateTime={detail.at}>
              {hhmm(detail.at)}
            </time>
          </div>
          <div className="flex items-center gap-3">
            <VerdictBadge verdict={detail.verdict} size="sm" />
            <span className="truncate font-mono text-title-mono-t1-rg text-grayscale-white">{detail.tool}</span>
          </div>
        </header>

        {detail.policies.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-body-text-b3-md text-grayscale-300">{t("matchingPolicies")}</h3>
            <div className="flex flex-wrap items-center gap-2">
              {detail.policies.map((id) => (
                <PolicyChip key={id} id={id} />
              ))}
            </div>
          </section>
        )}

        {(detail.threatScore > 0 || detail.detections.length > 0) && (
          <div className="flex gap-4">
            <StatPanel label={t("threatScore")} value={detail.threatScore} suffix="/100" danger />
            <StatPanel label={t("detections")} value={detail.detections.length} suffix={t("detectionUnit")} />
          </div>
        )}

        {detail.detections.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-body-text-b3-md text-grayscale-300">{t("detectionList")}</h3>
            <div className="flex flex-col">
              {detail.detections.map((d) => (
                <div
                  key={`${d.type}-${d.subtype}`}
                  className="flex items-center gap-3 py-3 shadow-[inset_0_-1px_0_0_var(--primitive-color-grayscale-800)]"
                >
                  <span className="flex-none rounded-[4px] bg-red-700 px-2 py-0.5 font-mono text-caption-mono-c-rg text-grayscale-white">
                    {d.type}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body-text-b3-md text-grayscale-200">{d.subtype}</span>
                  <span className="flex-none text-body-text-b3-bd text-grayscale-50">{d.confidence}%</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {detail.maskDiff && (
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-body-text-b3-md text-grayscale-300">Mask Diff</h3>
              <button
                type="button"
                onClick={() => setMaskExpanded((previous) => !previous)}
                aria-expanded={maskExpanded}
                className="flex h-[29px] items-center rounded-lg bg-(--primitive-opacity-white-alpha-25) px-3 text-body-text-b3-md transition-colors hover:bg-white/30"
              >
                {maskExpanded ? t("collapse") : t("expand")}
              </button>
            </div>
            <MaskDiffView diff={detail.maskDiff} expanded={maskExpanded} />
            {revealed && <p className="text-caption-text-c-rg text-(--primitive-opacity-white-alpha-75)">{t("revealed")}</p>}
          </section>
        )}

        <ChainPill status={detail.chain.status} hash={detail.chain.hash} />
      </div>

      {detail.canReveal && (
        <button
          type="button"
          onClick={() => setRevealOpen(true)}
          className="flex h-12 flex-none items-center justify-center gap-2 rounded-lg bg-blue-800 text-body-text-b2-md transition-colors hover:bg-blue-700"
        >
          <Lock className="size-5 flex-none" aria-hidden />
          {t("reveal")}
        </button>
      )}

      {revealOpen && (
        <RevealModal
          onCancel={() => setRevealOpen(false)}
          onConfirm={() => {
            setRevealOpen(false);
            setRevealed(true);
          }}
        />
      )}
    </div>
  );
}
