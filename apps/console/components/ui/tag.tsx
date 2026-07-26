import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The design's Tag component. Every chip on SCR-101 is one of these: trust tiers, policy ids,
 * verdicts, the approval count, the snapshot warning.
 *
 * Figma draws its 1px stroke *inside* the frame, so the ring is an inset shadow rather than a
 * border — a CSS border would add 2px to a chip whose height the design fixed at 20px.
 */
const TONE = {
  neutral: "bg-grayscale-800 text-grayscale-white shadow-[inset_0_0_0_1px_var(--primitive-color-grayscale-700)]",
  trusted:
    "bg-(--primitive-opacity-allow-alpha-10) text-green-500 shadow-[inset_0_0_0_1px_var(--primitive-opacity-allow-alpha-10)]",
  limited:
    "bg-(--primitive-opacity-warn-alpha-10) text-yellow-400 shadow-[inset_0_0_0_1px_var(--primitive-opacity-warn-alpha-10)]",
  untrusted:
    "bg-(--primitive-opacity-block-alpha-10) text-red-300 shadow-[inset_0_0_0_1px_var(--primitive-opacity-block-alpha-10)]",
  approval:
    "bg-(--primitive-opacity-require-approval-alpha-25) text-violet-100 shadow-[inset_0_0_0_1px_var(--primitive-opacity-require-approval-alpha-25)]",
  alert: "bg-red-700 text-grayscale-white"
} as const;

export type TagTone = keyof typeof TONE;

export interface TagProps {
  tone?: TagTone;
  /** `sm` is the 20px chip (radius 4); `pill` is the fully rounded 24px badge. */
  shape?: "sm" | "pill";
  className?: string;
  children: ReactNode;
}

export function Tag({ tone = "neutral", shape = "sm", className, children }: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex flex-none items-center gap-1",
        shape === "sm" ? "rounded-[4px] px-2 py-px" : "rounded-full px-2 py-0.5",
        TONE[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
