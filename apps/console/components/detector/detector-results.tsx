"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Search } from "lucide-react";
import type { DetectionFinding, DetectionPreview, Verdict } from "@/lib/api/types";
import { toVerdict } from "@/lib/verdict";
import { cn } from "@/lib/utils";

/** Fallback labels for a control plane that reports a policy id but no detector label. */
const TYPE_BY_POLICY: Record<string, string> = {
  mask_korean_phone: "PHONE",
  mask_korean_rrn: "RRN",
  mask_secret_token: "SECRET",
  block_env_file_read: "PATH",
  approve_external_email: "EMAIL"
};

// Straight off the design: red-700 / yellow-600 grounds, white type on both.
const TAG_TONE: Record<Verdict, string> = {
  block: "bg-red-700 text-grayscale-white",
  warn: "bg-yellow-600 text-grayscale-white",
  require_approval: "bg-(--primitive-opacity-require-approval-alpha-25) text-violet-100",
  allow: "bg-(--primitive-opacity-allow-alpha-10) text-verdict-allow"
};

export function labelOf(finding: DetectionFinding): string {
  return finding.type ?? TYPE_BY_POLICY[finding.policyId] ?? finding.policyId.toUpperCase();
}

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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <section aria-label={t("findings")} className="flex min-h-0 flex-1 flex-col gap-3">
        <h2 className="flex-none text-body-text-b2-md text-grayscale-300">{t("findings")}</h2>

        {!preview ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-(--primitive-opacity-white-alpha-10)">
              <Search className="size-5 text-grayscale-300" aria-hidden />
            </span>
            <p className="text-body-text-b1-md text-grayscale-white">{t("emptyTitle")}</p>
            <p className="text-body-text-b3-md text-grayscale-400">{t("emptyBody")}</p>
          </div>
        ) : preview.findings.length === 0 ? (
          <p role="status" className="flex flex-1 items-center justify-center text-body-text-b3-md text-grayscale-400">
            {t("noFindings")}
          </p>
        ) : (
          <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {preview.findings.map((finding) => (
              <li key={`${finding.policyId}-${finding.start}`}>
                <button
                  type="button"
                  onClick={() => onSelectFinding(finding)}
                  className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-white/5 shadow-[inset_0_-1px_0_0_var(--primitive-opacity-white-alpha-10)]"
                >
                  <span
                    className={cn(
                      "flex-none rounded-md px-2 py-1 font-mono text-caption-mono-c-rg",
                      TAG_TONE[toVerdict(finding.action)]
                    )}
                  >
                    {labelOf(finding)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body-text-b2-md text-grayscale-white">
                    {finding.matchedText}
                  </span>
                  {finding.confidence !== undefined && (
                    <span className="flex-none text-body-text-b2-md text-grayscale-200">{finding.confidence}%</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={t("maskedResult")} className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-none items-center gap-2">
          <h2 className="flex-1 text-body-text-b2-md text-grayscale-300">{t("maskedResult")}</h2>
          <button
            type="button"
            onClick={() => void copy()}
            disabled={!preview}
            aria-label={t("copy")}
            className={cn(
              "flex size-8 flex-none items-center justify-center rounded-lg bg-(--primitive-opacity-white-alpha-10) text-grayscale-300 transition-colors hover:text-grayscale-white",
              !preview && "cursor-not-allowed opacity-40"
            )}
          >
            <Copy className="size-4" aria-hidden />
          </button>
        </div>
        {copied && (
          <p role="status" className="flex-none text-caption-text-c-rg text-verdict-allow">
            {t("copied")}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-grayscale-900 p-4">
          {preview && (
            <p className="text-body-text-b2-md break-words whitespace-pre-wrap text-grayscale-white">
              {maskedParts(preview.maskedText).map((part, index) =>
                part.chip ? (
                  <span
                    key={index}
                    className="mx-1 rounded-md px-2 py-0.5 font-mono text-caption-mono-c-rg text-verdict-allow shadow-[inset_0_0_0_1px_var(--primitive-opacity-allow-alpha-10)]"
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
