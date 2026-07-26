"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { getPolicy } from "@/lib/api/client";
import type { PolicyDetail } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * Policy Chip (spec §3): a policy id that opens a YAML popover on click, with a link that jumps
 * to the policy on SCR-302. The YAML is loaded on first open from `GET /policies/{id}`.
 */
export function PolicyChip({ id }: { id: string }) {
  const t = useTranslations("replay.policy");
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PolicyDetail | null>(null);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Load the YAML the first time the popover opens.
  useEffect(() => {
    if (!open || detail || error) return;
    const controller = new AbortController();
    getPolicy(id, controller.signal)
      .then(setDetail)
      .catch(() => setError(true));
    return () => controller.abort();
  }, [open, detail, error, id]);

  // Dismiss on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "flex max-w-full items-center rounded-[4px] bg-grayscale-800 px-[7px] py-px font-mono text-caption-mono-c-rg text-grayscale-white shadow-[inset_0_0_0_1px_var(--primitive-color-grayscale-700)] transition-colors hover:bg-grayscale-700",
          open && "bg-grayscale-700"
        )}
      >
        <span className="truncate">{id}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={id}
          className="absolute top-full left-0 z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg bg-grayscale-900 p-3 shadow-xl shadow-black/50 outline-1 -outline-offset-1 outline-grayscale-700"
        >
          {error ? (
            <p className="text-body-text-b3-md text-grayscale-400">{t("loadError")}</p>
          ) : detail ? (
            <pre className="max-h-64 overflow-auto rounded-sm bg-(--primitive-opacity-black-alpha-25) p-3 font-mono text-caption-mono-c-rg whitespace-pre text-grayscale-100">
              {detail.yaml}
            </pre>
          ) : (
            <div className="h-24 animate-pulse motion-reduce:animate-none rounded-sm bg-(--primitive-opacity-white-alpha-6)" />
          )}
          <Link
            href={`/policies/${id}`}
            className="mt-3 flex h-8 items-center justify-center rounded-lg bg-blue-800 text-body-text-b3-md transition-colors hover:bg-blue-700"
          >
            {t("goToPolicy")}
          </Link>
        </div>
      )}
    </div>
  );
}
