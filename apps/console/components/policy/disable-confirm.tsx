"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import type { PolicyRow } from "@/lib/api/types";

/**
 * Confirmation for turning off a policy that blocks, or one rated critical (FR-POL-04).
 *
 * Disabling one of these removes a protection rather than adjusting one, and the console gives
 * no undo — the operator would have to find the row again to put it back. So this is the one
 * toggle that asks first.
 *
 * The design has no frame for it; the markup follows the SCR-301 reveal confirmation, which is
 * the console's established pattern for a destructive-ish confirm.
 */
export interface DisableConfirmProps {
  /** Why it is being questioned, naming what is being switched off. The two cases differ. */
  body: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Which policies are grave enough to confirm before disabling — a pack inherits it. */
export function needsConfirm(policy: PolicyRow): boolean {
  return policy.action === "block" || policy.severity === "critical";
}

export function DisableConfirm({ body, pending, onCancel, onConfirm }: DisableConfirmProps) {
  const t = useTranslations("policies.confirmDisable");

  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus has to move in and come back, and Tab must not wander behind the overlay — a dialog
    // that asks before dropping a protection is no use to someone who cannot reach its buttons.
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
    focusables()[0]?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return onCancel();
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onCancel}>
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-labelledby="confirm-disable-title"
        aria-describedby="confirm-disable-body"
        className="w-96 max-w-full rounded-lg bg-grayscale-900 p-6 shadow-xl shadow-black/50"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-disable-title" className="text-body-text-b1-bd text-grayscale-white">
          {t("title")}
        </h2>
        <p id="confirm-disable-body" className="text-body-text-b3-md mt-2 text-grayscale-300">
          {body}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-body-text-b3-md flex h-9 cursor-pointer items-center rounded-lg bg-(--primitive-opacity-white-alpha-6) px-4 transition-colors hover:bg-white/10"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="text-body-text-b3-md flex h-9 cursor-pointer items-center rounded-lg bg-red-700 px-4 transition-colors hover:bg-red-600 disabled:opacity-50"
          >
            {t("confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
