"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { AttackScenario } from "@/lib/api/types";
import { DropdownChevronIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * Scenario picker (spec §5.2 no.1): T-01…T-08, with the ones the runner does not cover yet
 * listed as 준비 중 and not selectable.
 */
export function ScenarioPicker({
  scenarios,
  selected,
  onSelect,
  disabled
}: {
  scenarios: AttackScenario[];
  selected: AttackScenario | undefined;
  onSelect: (id: string) => void;
  /** A run is in flight — the scenario cannot change under it. */
  disabled: boolean;
}) {
  const t = useTranslations("attackLab");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());

  const selectable = scenarios.filter((scenario) => scenario.available);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const first = selected?.available ? selected.id : selectable[0]?.id;
    if (first) optionRefs.current.get(first)?.focus();
  }, [open, selected, selectable]);

  /** Roving focus skips the 준비 중 entries, which cannot be chosen. */
  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key) || !selectable.length) return;
    event.preventDefault();
    const active = document.activeElement as HTMLElement | null;
    const index = selectable.findIndex((scenario) => optionRefs.current.get(scenario.id) === active);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? selectable.length - 1
          : event.key === "ArrowDown"
            ? Math.min(selectable.length - 1, index + 1)
            : Math.max(0, (index < 0 ? 0 : index) - 1);
    optionRefs.current.get(selectable[next].id)?.focus();
  };

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((previous) => !previous)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          "inline-flex h-11 w-full items-center gap-3 rounded-lg bg-grayscale-900 px-4 text-left transition-colors hover:bg-white/10",
          open && "bg-white/10",
          disabled && "cursor-not-allowed opacity-50 hover:bg-grayscale-900"
        )}
      >
        <span className="flex-none font-mono text-caption-mono-c-rg text-grayscale-300">
          {selected?.id ?? "—"}
        </span>
        <span className="min-w-0 flex-1 truncate text-body-text-b2-md text-grayscale-white">
          {selected?.title ?? t("pickScenario")}
        </span>
        <DropdownChevronIcon className={cn("size-6 flex-none transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t("pickScenario")}
          onKeyDown={onListKeyDown}
          className="absolute top-full left-0 z-30 mt-2 flex max-h-80 w-full flex-col gap-1 overflow-y-auto rounded-lg bg-grayscale-900 p-2 shadow-xl shadow-black/50 outline-1 -outline-offset-1 outline-grayscale-700"
        >
          {scenarios.map((scenario) => {
            const current = scenario.id === selected?.id;
            return (
              <button
                key={scenario.id}
                ref={(el) => {
                  if (el) optionRefs.current.set(scenario.id, el);
                  else optionRefs.current.delete(scenario.id);
                }}
                type="button"
                role="option"
                aria-selected={current}
                aria-disabled={!scenario.available}
                tabIndex={current && scenario.available ? 0 : -1}
                onClick={() => {
                  if (!scenario.available) return;
                  setOpen(false);
                  onSelect(scenario.id);
                }}
                className={cn(
                  "flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left transition-colors",
                  scenario.available ? "hover:bg-white/5" : "cursor-not-allowed opacity-50",
                  current && "bg-(--primitive-opacity-white-alpha-10)"
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="flex-none font-mono text-caption-mono-c-rg text-grayscale-300">{scenario.id}</span>
                  <span className="min-w-0 flex-1 truncate text-body-text-b3-md text-grayscale-white">
                    {scenario.title}
                  </span>
                  {!scenario.available && (
                    <span className="flex-none rounded-[4px] bg-(--primitive-opacity-white-alpha-10) px-2 py-px text-caption-text-c-rg text-grayscale-300">
                      {t("comingSoon")}
                    </span>
                  )}
                </span>
                <span className="truncate text-caption-text-c-rg text-(--primitive-opacity-white-alpha-75)">
                  {scenario.summary}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
