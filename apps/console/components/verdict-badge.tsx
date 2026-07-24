"use client";

import { useTranslations } from "next-intl";
import type { Verdict } from "@/lib/api/types";
import {
  VerdictAllowIcon,
  VerdictBlockIcon,
  VerdictRequireApprovalIcon,
  VerdictWarnIcon
} from "@/components/icons/scr-101";
import { cn } from "@/lib/utils";

/**
 * The only permitted way to show a verdict (UI specification §4.3): icon **and** text, never
 * colour on its own. Shared by SCR-101/201/301/402.
 *
 * The icons are the design's own vectors, so their colour is baked in to match the label, and
 * the 1px ring is an inset shadow because Figma draws the badge's stroke inside its 29px box.
 */
const STYLES = {
  allow: {
    Icon: VerdictAllowIcon,
    key: "allow",
    tone: "bg-(--primitive-opacity-allow-alpha-10) text-green-500 shadow-[inset_0_0_0_1px_var(--primitive-opacity-allow-alpha-10)]"
  },
  warn: {
    Icon: VerdictWarnIcon,
    key: "warn",
    tone: "bg-(--primitive-opacity-warn-alpha-10) text-yellow-400 shadow-[inset_0_0_0_1px_var(--primitive-opacity-warn-alpha-10)]"
  },
  require_approval: {
    Icon: VerdictRequireApprovalIcon,
    key: "requireApproval",
    tone: "bg-(--primitive-opacity-require-approval-alpha-25) text-violet-100 shadow-[inset_0_0_0_1px_var(--primitive-opacity-require-approval-alpha-25)]"
  },
  block: {
    Icon: VerdictBlockIcon,
    key: "block",
    tone: "bg-(--primitive-opacity-block-alpha-10) text-red-300 shadow-[inset_0_0_0_1px_var(--primitive-opacity-block-alpha-10)]"
  }
} as const;

export interface VerdictBadgeProps {
  verdict: Verdict;
  /** `md` is the 29px badge lists use; `sm` is the 24px one the status bar carries. */
  size?: "sm" | "md";
  /** Trailing detail, such as the number of pending approvals. */
  count?: number;
  className?: string;
}

export function VerdictBadge({ verdict, size = "md", count, className }: VerdictBadgeProps) {
  const t = useTranslations("verdict");
  const { Icon, key, tone } = STYLES[verdict];

  return (
    <span
      className={cn(
        "inline-flex flex-none items-center rounded-full",
        size === "md" ? "gap-2 px-2 py-1 text-body-text-b3-md" : "gap-1 px-2 py-0.5 text-caption-text-c-md",
        tone,
        className
      )}
    >
      <Icon className="h-5 w-4 flex-none" aria-hidden />
      {t(key)}
      {count !== undefined && <span>{count}</span>}
    </span>
  );
}
