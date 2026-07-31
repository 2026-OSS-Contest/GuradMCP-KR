"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Approval, ApprovalDecision } from "@/lib/api/types";
import { MaskedContent } from "@/components/replay/masked-content";
import { RawContent } from "./raw-content";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

/** Spec §5.6: the countdown starts flashing once the call has less than this left. */
const WARN_AT_MS = 20_000;

const TAG_TONE: Record<string, string> = {
  SECRET: "bg-red-700 text-grayscale-white",
  RRN: "bg-red-700 text-grayscale-white",
  PHONE: "bg-yellow-400 text-grayscale-black",
  INJECTION: "bg-yellow-400 text-grayscale-black"
};

function remainingMs(expiresAt: string): number {
  return Math.max(0, Date.parse(expiresAt) - Date.now());
}

/**
 * One held call (spec §5.6). The countdown runs against the gateway's own `expiresAt`, so a
 * slow render or a re-mount never invents time the operator does not have.
 */
export function ApprovalCard({
  approval,
  onDecide,
  busy
}: {
  approval: Approval;
  onDecide: (decision: ApprovalDecision) => void;
  busy: boolean;
}) {
  const t = useTranslations("approval");
  const [open, setOpen] = useState(Boolean(approval.maskPreview));
  const [left, setLeft] = useState(() => remainingMs(approval.expiresAt));

  useEffect(() => {
    const tick = () => setLeft(remainingMs(approval.expiresAt));
    tick();
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, [approval.expiresAt]);

  const seconds = Math.ceil(left / 1000);
  const urgent = left <= WARN_AT_MS;
  // The card headlines the call's subject — the recipient, the URL — over the raw argument map.
  const target = Object.values(approval.arguments)[0];

  return (
    <article className="flex flex-col gap-4 rounded-2xl bg-grayscale-900 p-6">
      <header className="flex flex-wrap items-start gap-3">
        <h3 className="flex min-w-0 flex-1 flex-wrap items-center gap-2 font-mono text-body-mono-b1-rg text-grayscale-white">
          {approval.toolName}
          {target && (
            <>
              <ChevronRight className="size-5 flex-none text-grayscale-400" aria-hidden />
              <span className="min-w-0 break-all text-(--primitive-opacity-white-alpha-75)">{target}</span>
            </>
          )}
        </h3>
        <span
          // Flashing is the last-20s signal; reduced motion keeps the colour and drops the blink.
          className={cn(
            "flex-none text-caption-text-c-rg",
            urgent ? "animate-pulse text-verdict-block motion-reduce:animate-none" : "text-grayscale-400"
          )}
        >
          {t("remaining", { seconds })}
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-body-text-b3-md text-grayscale-300">{t("riskReason")}</span>
        {approval.riskTags?.map((tag) => (
          <span
            key={tag.type}
            className={cn("flex-none rounded-md px-2 py-1 text-caption-text-c-rg", TAG_TONE[tag.type] ?? "bg-grayscale-700 text-grayscale-white")}
          >
            {t("riskTag", { type: tag.type, count: tag.count })}
          </span>
        ))}
        {approval.threatScore !== undefined && (
          <span className="flex items-center gap-1 text-body-text-b3-md text-grayscale-300">
            · {t("threatScore")}
            <span className="text-verdict-block">{approval.threatScore}</span>
          </span>
        )}
      </div>

      {approval.policyId && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-body-text-b3-md text-grayscale-300">{t("policy")}</span>
          <Tag className="text-caption-mono-c-rg">{approval.policyId}</Tag>
        </div>
      )}

      {approval.maskPreview && (
        <div className="flex flex-col gap-3 border-t border-(--primitive-opacity-white-alpha-10) pt-4">
          <button
            type="button"
            onClick={() => setOpen((previous) => !previous)}
            aria-expanded={open}
            className="flex items-center gap-2 self-start text-body-text-b3-md text-grayscale-200 transition-colors hover:text-grayscale-white"
          >
            {open ? <ChevronDown className="size-5" aria-hidden /> : <ChevronRight className="size-5" aria-hidden />}
            {t("maskPreview")}
          </button>

          {open && (
            <div className="grid gap-4 md:grid-cols-2">
              <section className="flex flex-col gap-2">
                <h4 className="flex items-center gap-2 text-body-text-b3-md text-red-300">
                  <span aria-hidden>○–</span>
                  {t("raw")}
                </h4>
                <div className="rounded-lg bg-(--primitive-opacity-block-alpha-6) p-3">
                  <RawContent lines={approval.maskPreview.raw} />
                </div>
              </section>
              <section className="flex flex-col gap-2">
                <h4 className="flex items-center gap-2 text-body-text-b3-md text-green-500">
                  <span aria-hidden>→</span>
                  {t("masked")}
                </h4>
                <div className="rounded-lg bg-(--primitive-opacity-allow-alpha-10) p-3">
                  <MaskedContent lines={approval.maskPreview.masked} />
                </div>
              </section>
            </div>
          )}
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => onDecide("approve")}
          disabled={busy}
          className={cn(
            "flex items-center gap-2 text-body-text-b2-md text-grayscale-white transition-opacity hover:opacity-80",
            busy && "cursor-not-allowed opacity-50"
          )}
        >
          {t("approve")}
          <Keycap>A</Keycap>
        </button>

        <span className="ml-auto flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => onDecide("block")}
            disabled={busy}
            className={cn(
              "flex h-12 items-center gap-2 rounded-xl bg-grayscale-700 px-5 text-body-text-b2-md text-grayscale-white transition-colors hover:bg-grayscale-600",
              busy && "cursor-not-allowed opacity-50"
            )}
          >
            {t("block")}
            <Keycap>B</Keycap>
          </button>
          <button
            type="button"
            onClick={() => onDecide("approve_masked")}
            disabled={busy}
            className={cn(
              "flex h-12 items-center gap-2 rounded-xl bg-blue-800 px-5 text-body-text-b2-md text-grayscale-white transition-colors hover:bg-blue-700",
              busy && "cursor-not-allowed opacity-50"
            )}
          >
            {t("approveMasked")}
            <Keycap>M</Keycap>
          </button>
        </span>
      </footer>
    </article>
  );
}

function Keycap({ children }: { children: string }) {
  return (
    <span className="flex size-6 flex-none items-center justify-center rounded-md bg-(--primitive-opacity-white-alpha-25) font-mono text-caption-mono-c-rg">
      {children}
    </span>
  );
}
