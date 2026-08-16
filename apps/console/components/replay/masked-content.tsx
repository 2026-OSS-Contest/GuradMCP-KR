import type { ContentLine } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/** A masked token rendered as a green chip, e.g. PHONE, BANK_ACCOUNT (spec §5.3). */
function MaskChip({ label }: { label: string }) {
  return (
    <span className="rounded-sm bg-(--primitive-opacity-allow-alpha-10) px-1.5 font-mono text-caption-mono-c-rg text-green-500">
      {label}
    </span>
  );
}

/**
 * Numbered, masked content — the input-original and return-summary sections of the detail
 * panel, and the "after" column of the reveal modal. Masked values show as chips.
 *
 * `nowrap` keeps every line on one line and lets the container scroll instead. The reveal modal
 * needs it: its two columns are read against each other line by line, and a line that wraps in
 * one column and not the other puts every row below it out of step.
 */
export function MaskedContent({ lines, nowrap }: { lines: ContentLine[]; nowrap?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1 font-mono text-body-mono-b3-rg text-grayscale-200", nowrap && "w-max")}>
      {lines.map((line) => (
        <div key={line.no} className="flex gap-2">
          <span className="flex-none text-(--primitive-opacity-white-alpha-50)">{line.no}</span>
          <span className={cn("flex min-w-0 items-center gap-x-0 gap-y-1", nowrap ? "flex-nowrap whitespace-pre" : "flex-wrap")}>
            {line.parts.map((part, index) =>
              "mask" in part ? <MaskChip key={index} label={part.mask} /> : <span key={index}>{part.text}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
