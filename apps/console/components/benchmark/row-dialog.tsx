"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { DialogPassIcon, RowFailIcon } from "./icons";
import type { RunRow } from "./use-benchmark-run";
import { cn } from "@/lib/utils";

/**
 * One labelled line of the case (the modal frame's label/value pairs). Identifiers read in mono;
 * the measured text does not — the mono face has no Korean, so a Korean sample set in it falls
 * back glyph by glyph and spaces oddly.
 */
function Field({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-body-text-b3-md text-grayscale-400">{label}</span>
      <span
        className={cn(
          "break-all text-grayscale-100",
          mono ? "font-mono text-body-mono-b2-rg" : "text-body-text-b2-md"
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * The whole case behind one row of the run.
 *
 * The list can only show a line each; this is where a reader checks what was actually sent, what
 * the run was supposed to conclude and what it did conclude — the difference between a screen
 * that claims a pass rate and one that can be audited.
 *
 * Markup follows `settings/risk-dialog.tsx`, the console's established modal: focus moves in,
 * Tab cycles inside, Escape and the backdrop close, focus returns to the row.
 */
export function RowDialog({ row, onClose }: { row: RunRow; onClose: () => void }) {
  const t = useTranslations("benchmark");
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
    focusables()[0]?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return onClose();
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [onClose]);

  const { source } = row;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-(--primitive-opacity-black-alpha-75) p-4" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="benchmark-row-title"
        // The frame's Modal: 632 wide, 24px inset, 24px between the body and the close button.
        className="flex max-h-[80vh] w-158 max-w-full flex-col gap-6 overflow-y-auto rounded-(--primitive-radius-rounded-xl) bg-grayscale-900 p-6 shadow-xl shadow-black/50"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-(--primitive-opacity-white-alpha-10) pb-2">
          {/* The frame titles a passed case with the check drawn white — the dialog's ground
              carries no verdict tint for it to sit on. A failure keeps the red block disc. */}
          {row.passed ? (
            <DialogPassIcon className="size-6 flex-none" aria-hidden />
          ) : (
            <RowFailIcon className="size-6 flex-none" aria-hidden />
          )}
          <h2 id="benchmark-row-title" className="min-w-0 flex-1 font-mono text-body-mono-b1-rg text-grayscale-white">
            {row.id}
          </h2>
          <span className="flex-none text-body-text-b3-md text-grayscale-300">{t(`section.${row.section}`)}</span>
        </div>

        {source.of === "sample" && (
          <>
            <Field label={t("field.text")} value={source.sample.text} mono={false} />
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("field.kind")} value={source.sample.kind ?? "—"} />
              <Field
                label={t("field.label")}
                value={t(source.sample.label ? "label.positive" : "label.negative")}
                mono={false}
              />
              <Field
                label={t("field.detected")}
                value={t(source.sample.detected ? "yes" : "no")}
                mono={false}
              />
              <Field label={t("field.result")} value={t(row.passed ? "rowPassed" : "rowFailed")} mono={false} />
            </div>
          </>
        )}

        {source.of === "scenario" && (
          <>
            {source.scenario.threat && (
              <div className="flex flex-col gap-1 rounded-lg bg-(--primitive-opacity-white-alpha-6) p-3">
                <span className="text-body-text-b3-md text-grayscale-white">
                  {source.scenario.threat.id} · {source.scenario.threat.name}
                </span>
                <span className="text-caption-text-c-rg text-grayscale-300">{source.scenario.threat.summary}</span>
                {source.scenario.threat.owasp.length > 0 && (
                  <span className="font-mono text-caption-mono-c-rg text-(--primitive-opacity-white-alpha-50)">
                    OWASP {source.scenario.threat.owasp.join(", ")}
                  </span>
                )}
              </div>
            )}
            <Field label={t("field.probe")} value={source.scenario.text ?? "—"} mono={false} />
            {source.scenario.args && (
              <Field label={t("field.args")} value={JSON.stringify(source.scenario.args)} />
            )}
            <div className="grid grid-cols-2 gap-4">
              <Field
                label={t("field.expected")}
                value={t(source.scenario.expectedBlocked ? "blocked" : "allowed")}
                mono={false}
              />
              <Field
                label={t("field.actual")}
                value={t(source.scenario.actualBlocked ? "blocked" : "allowed")}
                mono={false}
              />
            </div>
          </>
        )}

        {source.of === "fixture" && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("field.policy")} value={source.fixture.coverage.policy_id} />
              <Field label={t("field.expectation")} value={source.fixture.coverage.expectation} />
              <Field label={t("field.expected")} value={source.fixture.expected.action} />
              <Field label={t("field.actual")} value={source.fixture.actual.action} />
            </div>
            <Field
              label={t("field.matched")}
              value={source.fixture.actual.matched_policy_ids.join(", ") || "—"}
            />
          </>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 cursor-pointer items-center rounded-(--primitive-radius-rounded-xl) bg-(--primitive-opacity-white-alpha-25) px-4 text-body-text-b2-md text-grayscale-white transition-opacity hover:opacity-80"
          >
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}
