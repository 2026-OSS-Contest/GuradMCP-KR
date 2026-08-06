"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * The disclosure both dangerous settings put in front of the operator (spec §5.7).
 *
 * The two the design draws differ in exactly one way: switching to fail-open also demands an
 * explicit acknowledgement before its confirm button comes alive, because that one changes what
 * happens when the guard itself is down. Turning on raw storage only explains itself. So the
 * checkbox is a prop rather than two near-identical dialogs.
 *
 * Markup follows the SCR-301 reveal confirmation, the console's established pattern.
 */
export interface RiskDialogProps {
  title: string;
  body: string;
  /** Label for the acknowledgement checkbox. Omitted, the confirm button is live immediately. */
  acknowledgement?: string;
  confirmLabel: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RiskDialog({
  title,
  body,
  acknowledgement,
  confirmLabel,
  pending,
  onCancel,
  onConfirm
}: RiskDialogProps) {
  const t = useTranslations("settings");
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const blocked = Boolean(acknowledgement) && !acknowledged;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onCancel}>
      <div
        role="alertdialog"
        aria-labelledby="risk-dialog-title"
        aria-describedby="risk-dialog-body"
        className="w-100 max-w-full rounded-(--primitive-radius-rounded-xl) bg-grayscale-900 p-6 shadow-xl shadow-black/50"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="risk-dialog-title" className="text-body-text-b1-bd text-grayscale-white">
          {title}
        </h2>
        <p id="risk-dialog-body" className="text-body-text-b3-md mt-3 text-grayscale-300">
          {body}
        </p>

        {acknowledgement && (
          <label className="text-body-text-b2-md mt-6 flex cursor-pointer items-center gap-3 text-grayscale-white">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="size-4 flex-none accent-blue-600"
            />
            {acknowledgement}
          </label>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-body-text-b2-md flex h-10 cursor-pointer items-center rounded-(--primitive-radius-rounded-lg) bg-(--primitive-opacity-white-alpha-6) px-4 transition-colors hover:bg-white/10"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={blocked || pending}
            className="text-body-text-b2-md flex h-10 cursor-pointer items-center rounded-(--primitive-radius-rounded-lg) bg-blue-800 px-4 text-grayscale-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
