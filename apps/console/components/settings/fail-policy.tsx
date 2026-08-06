"use client";

import { useTranslations } from "next-intl";
import type { FailMode } from "@/lib/api/types";
import { RadioSelectedIcon, RadioUnselectedIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * What the gateway does when its own guard is unavailable (spec §5.7, GMCP-68).
 *
 * Fail-closed is the shipped default and the safe one: no guard, no tool calls. Fail-open keeps
 * the agent working and hands the judgement back to the operator, which is why choosing it is
 * the one setting on this screen that demands an explicit acknowledgement.
 */
export interface FailPolicyProps {
  value: FailMode;
  onChange: (mode: FailMode) => void;
  disabled?: boolean;
}

const MODES: readonly FailMode[] = ["fail_closed", "fail_open"];

export function FailPolicy({ value, onChange, disabled }: FailPolicyProps) {
  const t = useTranslations("settings");

  return (
    <section aria-labelledby="fail-policy-title" className="flex flex-col gap-4">
      <h2 id="fail-policy-title" className="text-body-text-b3-md text-grayscale-300">
        {t("failPolicy.title")}
      </h2>
      <div
        role="radiogroup"
        aria-labelledby="fail-policy-title"
        className="flex flex-1 flex-col gap-3 rounded-(--primitive-radius-rounded-xl) bg-grayscale-900 p-3"
      >
        {MODES.map((mode) => {
          const selected = value === mode;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(mode)}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-(--primitive-radius-rounded-xl) p-4 text-left transition-colors",
                selected ? "bg-(--primitive-opacity-white-alpha-6)" : "hover:bg-(--primitive-opacity-white-alpha-6)",
                disabled && "cursor-not-allowed opacity-50"
              )}
            >
              <span className="flex items-center gap-3">
                {selected ? (
                  <RadioSelectedIcon aria-hidden className="size-6 flex-none" />
                ) : (
                  <RadioUnselectedIcon aria-hidden className="size-6 flex-none" />
                )}
                <span className="text-body-text-b2-md text-grayscale-white">{t(`failPolicy.${mode}.label`)}</span>
                {mode === "fail_closed" && (
                  <span className="text-caption-text-c-md rounded-full bg-blue-800 px-2 py-0.5 text-grayscale-white">
                    {t("failPolicy.default")}
                  </span>
                )}
              </span>
              <span className="text-body-text-b3-md pl-8 text-grayscale-400">{t(`failPolicy.${mode}.desc`)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
