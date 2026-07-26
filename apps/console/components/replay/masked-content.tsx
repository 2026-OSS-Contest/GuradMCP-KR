import type { ContentLine } from "@/lib/api/types";

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
 */
export function MaskedContent({ lines }: { lines: ContentLine[] }) {
  return (
    <div className="flex flex-col gap-1 font-mono text-caption-mono-c-rg text-grayscale-200">
      {lines.map((line) => (
        <div key={line.no} className="flex gap-2">
          <span className="flex-none text-(--primitive-opacity-white-alpha-50)">{line.no}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-0 gap-y-1">
            {line.parts.map((part, index) =>
              "mask" in part ? <MaskChip key={index} label={part.mask} /> : <span key={index}>{part.text}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
