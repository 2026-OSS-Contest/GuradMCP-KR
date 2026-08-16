"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Info, X } from "lucide-react";
import type { RevealContent } from "@/lib/api/types";
import { RevealMaskedIcon, RevealRawIcon } from "@/components/icons";
import { MaskedContent } from "./masked-content";

/**
 * Reveal-original modal (spec §5.3 no.5): the raw source next to its masked form, shown after the
 * operator confirms. The access is already recorded in the audit log; closing re-masks.
 */
export function RevealModal({ content, onClose }: { content: RevealContent; onClose: () => void }) {
  const t = useTranslations("replay.reveal");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-labelledby="reveal-modal-title"
        className="flex max-h-[calc(100vh-2rem)] w-[880px] max-w-full flex-col gap-4 rounded-xl bg-grayscale-900 p-6 shadow-2xl shadow-black/60"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-3">
              <h2 id="reveal-modal-title" className="text-body-text-b1-md text-grayscale-300">
                Mask Diff
              </h2>
              <span className="flex items-center gap-1 rounded-full bg-(--primitive-opacity-white-alpha-25) px-2 py-0.5 text-caption-text-c-md text-grayscale-white">
                {t("revealing")}
              </span>
            </span>
            <span className="font-mono text-caption-mono-c-rg text-(--primitive-opacity-white-alpha-75)">
              {content.source} {content.caseId}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="flex size-8 flex-none items-center justify-center rounded-lg text-grayscale-300 transition-colors hover:bg-white/10 hover:text-grayscale-white"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <p className="flex items-center gap-2 text-body-text-b3-md text-grayscale-300">
          <Info className="size-4 flex-none" aria-hidden />
          {t("notice")}
        </p>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto md:grid-cols-2">
          <section className="flex flex-col gap-2">
            {/* The frame carries the colour on the icon and leaves the label white and bold. */}
            <h3 className="flex items-center gap-2 text-body-text-b3-bd text-grayscale-white">
              <RevealRawIcon className="size-5 flex-none text-red-500" aria-hidden />
              {t("raw")}
            </h3>
            {/* Same numbered-line layout as MaskedContent so a raw line and its masked
                counterpart share a row height and stay aligned across the two columns. */}
            {/* Scrolls sideways rather than wrapping: the two columns are read line against line,
                and a line that wraps on one side and not the other puts every row below it out of
                step — which is the whole point of showing them side by side. */}
            <div className="overflow-x-auto rounded-lg bg-(--primitive-opacity-black-alpha-75) p-3">
              <div className="flex w-max flex-col gap-1 font-mono text-body-mono-b3-rg text-grayscale-200">
                {content.raw.split("\n").map((text, index) => (
                  <div key={index} className="flex gap-2">
                    <span className="flex-none text-(--primitive-opacity-white-alpha-50)">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="whitespace-pre">{text}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-body-text-b3-bd text-grayscale-white">
              <RevealMaskedIcon className="size-5 flex-none text-green-700" aria-hidden />
              {t("masked")}
            </h3>
            <div className="overflow-x-auto rounded-lg bg-(--primitive-opacity-allow-alpha-10) p-3">
              <MaskedContent lines={content.masked} nowrap />
            </div>
          </section>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 items-center rounded-lg bg-blue-800 px-5 text-body-text-b2-md text-grayscale-white transition-colors hover:bg-blue-700"
          >
            {t("stop")}
          </button>
        </div>
      </div>
    </div>
  );
}
