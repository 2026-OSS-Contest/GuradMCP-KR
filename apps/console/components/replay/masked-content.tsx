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

/** The value a chip stands in for, on the raw side: 기획서 10.4's 밑줄+틴트 하이라이트. */
function SecretRun({ value }: { value: string }) {
  return <span className="text-red-300 underline decoration-red-500 underline-offset-2">{value}</span>;
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
    // The 4px that used to sit between lines is inside them now, as padding. A tint drawn on a
    // line has to reach the line above and below it — consecutive masked lines are one block in
    // the design, and a gap between them breaks it into stripes. The rhythm is unchanged: the
    // container gives back what the first and last line's own padding added.
    <div className={cn("-my-0.5 flex flex-col font-mono text-body-mono-b3-rg text-grayscale-200", nowrap && "w-max")}>
      {lines.map((line) => (
        // A line the masking touched carries the tint; the run it touched carries the rule.
        <div
          key={line.no}
          className={cn(
            "flex gap-2 py-0.5",
            line.parts.some((part) => "secret" in part) && "bg-(--primitive-opacity-block-alpha-10)"
          )}
        >
          <span className="flex-none text-(--primitive-opacity-white-alpha-50)">{line.no}</span>
          <span className={cn("flex min-w-0 items-center gap-x-0 gap-y-1", nowrap ? "flex-nowrap whitespace-pre" : "flex-wrap")}>
            {line.parts.map((part, index) =>
              "mask" in part ? (
                <MaskChip key={index} label={part.mask} />
              ) : "secret" in part ? (
                <SecretRun key={index} value={part.secret} />
              ) : (
                <span key={index}>{part.text}</span>
              )
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
