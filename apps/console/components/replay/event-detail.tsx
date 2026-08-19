"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { revealEvent } from "@/lib/api/client";
import { hasOperatorPermissions } from "@/lib/api/permissions";
import type { DirectionVerdict, EventDetail, RevealContent, TimelineNodeType } from "@/lib/api/types";
import { VerdictBadge } from "@/components/verdict-badge";
import { RevealLockIcon, VerdictAllowIcon, VerdictWarnIcon } from "@/components/icons";
import { PolicyChip } from "./policy-chip";
import { MaskDiffView } from "./mask-diff";
import { MaskedContent } from "./masked-content";
import { RevealModal } from "./reveal-modal";
import { cn } from "@/lib/utils";

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-body-text-b3-md text-grayscale-300">{children}</h3>;
}

/** 위협 점수 / 탐지 count panels. */
function StatPanel({ label, value, suffix, suffixType, danger }: { label: string; value: number | string; suffix?: string; suffixType?: string; danger?: boolean }) {
  return (
    <div className="flex flex-1 flex-col gap-2 rounded-lg bg-grayscale-900 px-3 py-2 shadow-[inset_0_0_0_1px_var(--primitive-color-grayscale-800)]">
      <span className="text-body-text-b3-md text-grayscale-300">{label}</span>
      {/* Baseline, not the box bottom: the two are set at 36px and 18px, so aligning their boxes
          leaves the digits sitting on different lines. `pb-2` had been nudging the smaller one
          back up by eye — the frame simply puts them on one baseline. */}
      <span className="flex items-baseline justify-end gap-1">
        <b className={cn("text-header-text-h-bd", danger ? "text-red-400" : "text-grayscale-white")}>{value}</b>
        {suffix && <span className={cn("text-(--primitive-opacity-white-alpha-50)", suffixType ?? "text-caption-text-c-md")}>{suffix}</span>}
      </span>
    </div>
  );
}

/**
 * The tool call's arguments, with the values picked out. Keys, braces and commas are structure —
 * the same for every call — while a value is what this call actually carried, so it is the one run
 * that takes a colour. The frame colours `".env"` alone and leaves the rest grey.
 *
 * A quoted run is a key when a colon follows it, and a value otherwise; numbers, booleans and null
 * are always values.
 */
const JSON_TOKEN = /("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null)/g;

function ArgsJson({ json }: { json: string }) {
  const parts = json.split(JSON_TOKEN);
  return (
    <pre className="overflow-x-auto rounded-lg bg-(--primitive-opacity-black-alpha-75) p-3 font-mono text-body-mono-b3-rg text-grayscale-300">
      {parts.map((part, index) => {
        const quoted = part.startsWith('"');
        const isKey = quoted && /^\s*:/.test(parts[index + 1] ?? "");
        const isValue = index % 2 === 1 && !isKey;
        return isValue ? (
          <span key={index} className="text-green-200">
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        );
      })}
    </pre>
  );
}

/** The direction verdict a tool-call / result carries: a verdict badge + policy chip. */
function Direction({ direction, kind }: { direction: DirectionVerdict; kind: TimelineNodeType }) {
  const t = useTranslations("replay.detail");
  return (
    <section className="flex flex-col gap-2">
      <SectionHeading>{kind === "result" ? t("responseDirection") : t("requestDirection")}</SectionHeading>
      <div className="flex flex-wrap items-center gap-3">
        <VerdictBadge verdict={direction.verdict} size="sm" />
        <PolicyChip id={direction.policy} />
        {direction.morePolicies ? (
          <span className="text-body-text-b3-rg text-grayscale-100">{t("morePolicies", { count: direction.morePolicies })}</span>
        ) : null}
      </div>
    </section>
  );
}

/** Chain Status Pill (spec §5.3 no.4⑤): verified is green, a hash-chain mismatch turns it yellow. */
function ChainPill({ status, hash }: NonNullable<EventDetail["chain"]>) {
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

/** Step 1 of reveal-original: the audit-log confirmation (spec §5.3 no.5). */
function ConfirmRevealModal({ onCancel, onConfirm, pending }: { onCancel: () => void; onConfirm: () => void; pending: boolean }) {
  const t = useTranslations("replay.reveal");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onCancel}>
      <div
        role="alertdialog"
        aria-labelledby="confirm-reveal-title"
        aria-describedby="confirm-reveal-body"
        className="w-96 max-w-full rounded-xl bg-grayscale-900 p-6 shadow-xl shadow-black/50"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-reveal-title" className="text-body-text-b1-bd text-grayscale-white">
          {t("title")}
        </h2>
        <p id="confirm-reveal-body" className="mt-2 text-body-text-b3-md text-grayscale-300">
          {t("body")}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-9 items-center rounded-xl bg-(--primitive-opacity-white-alpha-6) px-4 text-body-text-b2-md transition-colors hover:bg-white/10"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="flex h-9 items-center rounded-xl bg-blue-800 px-4 text-body-text-b2-md transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {t("continue")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * SCR-301 event detail panel (spec §5.3 no.4). The header (verdict, tool) is always shown; the
 * body is node-type specific — the user's input, the agent's summary, the tool call, the block
 * verdict's fixed-order breakdown, or the tool result — so each timeline node reads differently.
 */
export function EventDetailPanel({ detail }: { detail: EventDetail }) {
  const t = useTranslations("replay.detail");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [revealed, setRevealed] = useState<RevealContent | null>(null);

  // Reset any open reveal when the selected event changes.
  useEffect(() => {
    setConfirmOpen(false);
    setRevealed(null);
  }, [detail.id]);

  const confirmReveal = async () => {
    setPending(true);
    try {
      // The real endpoint records the access; here MSW returns the raw content.
      setRevealed(await revealEvent(detail.id));
      setConfirmOpen(false);
    } finally {
      setPending(false);
    }
  };

  const isVerdict = detail.kind === "verdict";
  const monoTitle = detail.kind === "tool_call" || detail.kind === "result";

  return (
    <div data-testid="event-detail" className="flex h-full flex-col justify-between gap-4 px-4 py-6">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <header className="flex flex-col gap-3 pb-3 shadow-[inset_0_-1px_0_0_var(--primitive-opacity-white-alpha-10)]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-body-text-b3-md text-grayscale-300">{t("title")}</span>
            <time className="flex-none text-caption-text-c-rg text-(--primitive-opacity-white-alpha-50)" dateTime={detail.at}>
              {hhmm(detail.at)}
            </time>
          </div>
          <div className="flex items-center gap-3">
            {isVerdict && <VerdictBadge verdict={detail.verdict} size="sm" />}
            <span
              className={cn(
                "min-w-0 break-words text-grayscale-white",
                // User and agent nodes are titled with their own prose summary, so they take the
                // design's title type rather than mono (frame `…-agent-단계`, GMCP-115 A-2).
                monoTitle || isVerdict ? "font-mono text-title-mono-t1-rg" : "text-title-text-t1-bd"
              )}
            >
              {detail.tool}
            </span>
          </div>
        </header>

        {/* Agent — its own summary of the decision. */}
        {detail.summary && (
          <section className="flex flex-col gap-2">
            <SectionHeading>{t("agentSummary")}</SectionHeading>
            {/* The frame sets the report on its own ground with a 4px blue rule down the left —
                the agent speaking, marked off from the panel's own reporting around it. Padding
                is 12 on three sides and 16 against the rule, so the text clears it. */}
            <p className="bg-(--primitive-opacity-white-alpha-6) py-3 pr-3 pl-4 text-body-text-b3-md text-grayscale-white shadow-[inset_4px_0_0_0_var(--primitive-color-blue-800)]">
              {detail.summary}
            </p>
          </section>
        )}

        {/* Tool call — target and JSON arguments. */}
        {detail.call && (
          <>
            <section className="flex flex-col gap-2">
              <SectionHeading>{t("target")}</SectionHeading>
              <span className="w-fit max-w-full truncate rounded-[4px] bg-grayscale-800 px-[7px] py-px font-mono text-caption-mono-c-rg text-grayscale-white shadow-[inset_0_0_0_1px_var(--primitive-color-grayscale-700)]">
                {detail.call.target}
              </span>
            </section>
            <section className="flex flex-col gap-2">
              <SectionHeading>
                {t("args")} <span className="text-grayscale-300">{t("argsCount", { count: detail.call.argsCount })}</span>
              </SectionHeading>
              <ArgsJson json={detail.call.argsJson} />
            </section>
          </>
        )}

        {/* Tool call — normalized path (FR-SEC-04, GMCP-73): the raw arg above, resolved here. */}
        {detail.normalizedPath && (
          <section className="flex flex-col gap-2">
            <SectionHeading>{t("normalizedPath")}</SectionHeading>
            <span className="w-fit max-w-full truncate rounded-[4px] bg-grayscale-800 px-[7px] py-px font-mono text-caption-mono-c-rg text-grayscale-white shadow-[inset_0_0_0_1px_var(--primitive-color-grayscale-700)]">
              {detail.normalizedPath}
            </span>
          </section>
        )}

        {/* Verdict — matching policies. */}
        {detail.policies && detail.policies.length > 0 && (
          <section className="flex flex-col gap-2">
            <SectionHeading>{t("matchingPolicies")}</SectionHeading>
            <div className="flex flex-wrap items-center gap-2">
              {detail.policies.map((id) => (
                <PolicyChip key={id} id={id} />
              ))}
            </div>
          </section>
        )}

        {/* Verdict — threat score and detection count. */}
        {(detail.threatScore !== undefined || (detail.detections && detail.detections.length > 0)) && (
          <div className="flex gap-4">
            <StatPanel label={t("threatScore")} value={detail.threatScore ?? 0} suffix="/100" suffixType="text-body-text-b1-bd" danger />
            <StatPanel label={t("detections")} value={detail.detections?.length ?? 0} suffix={t("detectionUnit")} />
          </div>
        )}

        {/* Verdict — detection list. */}
        {detail.detections && detail.detections.length > 0 && (
          <section className="flex flex-col gap-2">
            <SectionHeading>{t("detectionList")}</SectionHeading>
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

        {/* User input / tool result — numbered, masked content. */}
        {detail.body && (
          <section className="flex flex-col gap-2">
            <SectionHeading>{detail.kind === "result" ? t("returnSummary") : t("inputOriginal")}</SectionHeading>
            <div className="rounded-lg bg-(--primitive-opacity-black-alpha-75) p-3">
              <MaskedContent lines={detail.body} />
            </div>
          </section>
        )}

        {/* Tool call / result — direction verdict. */}
        {detail.direction && <Direction direction={detail.direction} kind={detail.kind} />}

        {/* Verdict — mask diff. The frame heads it with a 상세 보기 button; it is not here, because
            what that button opens is unsettled. The frame behind it shows a modal carrying the raw
            phone, account and RRN values with no confirmation — the audit gate 화면설계서 5.3 no.5
            puts in front of 원문 열람, skipped. Until the designer says which it is, a button that
            only relabels itself is worse than none: the clamp it used to release never engaged at
            the sizes this diff runs to, so it changed nothing on screen. */}
        {detail.maskDiff && (
          <section className="flex flex-col gap-2">
            <SectionHeading>Mask Diff</SectionHeading>
            <MaskDiffView diff={detail.maskDiff} />
          </section>
        )}

        {/* Verdict — chain status. */}
        {detail.chain && <ChainPill status={detail.chain.status} hash={detail.chain.hash} />}
      </div>

      {/*
        GMCP-84 §8.2: three states off two independent signals.
        - No operator identity at all (`hasOperatorPermissions()` false): button not rendered —
          the real gate is server-side (PermissionService) regardless, but there is no point
          offering a control that will always 403.
        - Operator identity present but this event has no stored raw payload (`hasRawPayload`
          false): rendered, disabled, with a tooltip explaining why.
        - Both true: the normal active button.
      */}
      {hasOperatorPermissions() && (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={!detail.hasRawPayload}
          title={detail.hasRawPayload ? undefined : t("revealUnavailable")}
          className="flex h-12 flex-none items-center justify-center gap-2 rounded-xl bg-blue-800 text-body-text-b2-md transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-grayscale-800 disabled:text-grayscale-300 disabled:hover:bg-grayscale-800"
        >
          <RevealLockIcon className="h-6 w-5 flex-none" aria-hidden />
          {t("reveal")}
        </button>
      )}

      {confirmOpen && <ConfirmRevealModal onCancel={() => setConfirmOpen(false)} onConfirm={confirmReveal} pending={pending} />}
      {revealed && <RevealModal content={revealed} onClose={() => setRevealed(null)} />}
    </div>
  );
}
