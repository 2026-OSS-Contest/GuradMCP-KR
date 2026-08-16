"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CopyIcon, DetectorEmptyIcon } from "@/components/icons";
import type { DetectionFinding, DetectionPreview, Verdict } from "@/lib/api/types";
import { labelOf, subtypeOf } from "@/lib/detection-labels";
import { toVerdict } from "@/lib/verdict";
import { cn } from "@/lib/utils";

// The design's red-700 / yellow-600 grounds. White type holds on the red (AA) but not on the
// yellow — it measured 2.10:1 there, so that chip takes near-black type instead, at 8.18:1.
const TAG_TONE: Record<Verdict, string> = {
  block: "bg-red-700 text-grayscale-white",
  warn: "bg-yellow-600 text-grayscale-950",
  require_approval: "bg-(--primitive-opacity-require-approval-alpha-25) text-violet-100",
  allow: "bg-(--primitive-opacity-allow-alpha-10) text-verdict-allow"
};

/** Masked output arrives as text with `[LABEL]` stand-ins; those become chips, the rest is copy. */
function maskedParts(masked: string) {
  return masked.split(/(\[[A-Z0-9_]+\])/g).map((part) => ({
    text: part,
    chip: /^\[[A-Z0-9_]+\]$/.test(part) ? part.slice(1, -1) : undefined
  }));
}

/**
 * The right half of SCR-401: what was found, and what the text becomes once masked. Clicking a
 * finding selects it in the input, which is how the operator sees where it came from.
 */
export function DetectorResults({
  preview,
  onSelectFinding
}: {
  preview: DetectionPreview | undefined;
  onSelectFinding: (finding: DetectionFinding) => void;
}) {
  const t = useTranslations("detector");
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!preview) return;
    await navigator.clipboard.writeText(preview.maskedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  };

  const hasFindings = Boolean(preview && preview.findings.length > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/*
        The two halves share the column evenly until there is something to report, which is what
        the 입력 전 and 입력 완료 frames draw. Once findings arrive the list shrinks to them —
        the 탐지 완료 frame puts the masked heading at y=272 rather than the 555 of the other two —
        and the masked text takes what it gives up. Capped at half so a long list scrolls instead
        of pushing the masked pane back off the screen.
      */}
      <section
        aria-label={t("findings")}
        className={cn("flex min-h-0 flex-col gap-3", hasFindings ? "max-h-1/2 flex-none" : "flex-1")}
      >
        <h2 className="flex-none text-body-text-b3-md text-grayscale-300">{t("findings")}</h2>

        {!preview ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <DetectorEmptyIcon aria-hidden className="size-10" />
            <p className="text-title-text-t2-bd text-grayscale-white">{t("emptyTitle")}</p>
            <p className="text-body-text-b2-md text-grayscale-400">{t("emptyBody")}</p>
          </div>
        ) : preview.findings.length === 0 ? (
          <p role="status" className="flex flex-1 items-center justify-center text-body-text-b3-md text-grayscale-400">
            {t("noFindings")}
          </p>
        ) : (
          <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {preview.findings.map((finding) => {
              const subtype = subtypeOf(finding);
              return (
              <li key={`${finding.policyId}-${finding.start}`}>
                <button
                  type="button"
                  onClick={() => onSelectFinding(finding)}
                  className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-white/5 shadow-[inset_0_-1px_0_0_var(--primitive-opacity-white-alpha-10)]"
                >
                  {/* The design's Tag carries two texts side by side — the label, and a trailing
                      value the 승인 대기 badge fills with its count. The subtype goes in that
                      second slot, quieter than the label it qualifies. */}
                  <span
                    className={cn(
                      "flex flex-none items-center gap-1.5 rounded-(--primitive-radius-rounded-sm) px-2 py-0.5 font-mono text-caption-mono-c-rg",
                      TAG_TONE[toVerdict(finding.action)]
                    )}
                  >
                    {labelOf(finding)}
                    {subtype && <span className="opacity-70">{subtype}</span>}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body-text-b2-md text-grayscale-white">
                    {finding.matchedText}
                  </span>
                  {finding.confidence !== undefined && (
                    <span className="flex-none text-body-text-b2-md text-grayscale-200">{finding.confidence}%</span>
                  )}
                </button>
              </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label={t("maskedResult")} className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-none items-center gap-2">
          <h2 className="flex-1 text-body-text-b3-md text-grayscale-300">{t("maskedResult")}</h2>
          <button
            type="button"
            onClick={() => void copy()}
            disabled={!preview}
            aria-label={t("copy")}
            className={cn(
              "flex size-8 flex-none items-center justify-center rounded-(--primitive-radius-rounded-lg) bg-(--primitive-opacity-white-alpha-25) text-grayscale-300 transition-colors hover:text-grayscale-white",
              !preview && "cursor-not-allowed opacity-40"
            )}
          >
            <CopyIcon className="size-5" aria-hidden />
          </button>
        </div>
        {copied && (
          <p role="status" className="flex-none text-caption-text-c-rg text-verdict-allow">
            {t("copied")}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-(--primitive-radius-rounded-xl) bg-grayscale-900 p-4">
          {preview && (
            <p className="text-body-text-b2-md break-words whitespace-pre-wrap text-grayscale-white">
              {maskedParts(preview.maskedText).map((part, index) =>
                part.chip ? (
                  <span
                    key={index}
                    className="mx-1 rounded-(--primitive-radius-rounded-sm) bg-(--primitive-opacity-white-alpha-10) px-2 py-0.5 font-mono text-caption-mono-c-rg text-green-200"
                  >
                    {part.chip}
                  </span>
                ) : (
                  <span key={index}>{part.text}</span>
                )
              )}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
