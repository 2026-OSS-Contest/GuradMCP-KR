"use client";

import type { ReactNode } from "react";
import { DropdownChevronIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * The design's Dropdown: a rounded field with the caret it draws itself.
 *
 * A bare `<select>` renders the browser's own arrow — a thin stroked chevron — where the design
 * uses a filled caret, and there is no way to restyle that arrow. So the native control keeps the
 * behaviour and loses its appearance, and `DropdownChevronIcon` (already extracted for SCR-000's
 * session picker) sits on top.
 */
export interface SelectProps<T extends string | number> {
  value: T;
  onChange: (value: string) => void;
  disabled?: boolean;
  label: string;
  /** Forwarded to the native control, so a caller can address one field among many. */
  id?: string;
  /** Sizing and ink; the frame gives the settings fields 32px and the trust column 24px. */
  className?: string;
  children: ReactNode;
}

export function Select<T extends string | number>({
  value,
  onChange,
  disabled,
  label,
  id,
  className,
  children
}: SelectProps<T>) {
  return (
    <span className="relative inline-flex flex-none items-center">
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "w-full cursor-pointer appearance-none rounded-(--primitive-radius-rounded-lg) bg-grayscale-800",
          "py-0 pr-7 pl-3 text-grayscale-white",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
          disabled && "cursor-not-allowed opacity-50",
          className
        )}
      >
        {children}
      </select>
      <DropdownChevronIcon aria-hidden className="pointer-events-none absolute right-1 size-6" />
    </span>
  );
}
