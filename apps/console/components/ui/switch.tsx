"use client";

import { cn } from "@/lib/utils";

/**
 * The design's Toggle: a 45×24 track with a 20px knob, on-track in blue-600.
 *
 * A real `<button role="switch">` rather than a styled checkbox, so the pressed state is one
 * attribute the tests and screen readers both read, and so a disabled toggle refuses the click
 * outright instead of relying on pointer-events.
 */
export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Required: the toggle carries no visible label of its own in any of its uses. */
  label: string;
  className?: string;
}

export function Switch({ checked, onChange, disabled, label, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-[45px] flex-none rounded-full transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
        checked ? "bg-blue-600" : "bg-grayscale-700",
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-0.5 size-5 rounded-full bg-grayscale-white transition-[left]",
          checked ? "left-[23px]" : "left-0.5"
        )}
      />
    </button>
  );
}
