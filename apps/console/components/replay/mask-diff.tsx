"use client";

import type { MaskDiff } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * Mask Diff View (spec §5.3 no.4④): the text before masking (red) over the masked result
 * (green). Masked replacement tokens in the "after" block are shown as chips, mirroring the
 * design. `expanded` drops the line clamp so the whole diff is readable.
 */
function DiffLines({ text, masked }: { text: string; masked: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 font-mono text-caption-mono-c-rg">
      {text.split("\n").map((line, index) => {
        const [key, ...rest] = line.split("=");
        const value = rest.join("=");
        return (
          <div key={index} className={cn("flex flex-wrap items-center gap-1", masked ? "text-green-500" : "text-red-300")}>
            <span className="break-all">{key}=</span>
            {value &&
              (masked ? (
                <span className="rounded-sm bg-(--primitive-opacity-white-alpha-10) px-1.5">{value}</span>
              ) : (
                <span className="break-all underline">{value}</span>
              ))}
          </div>
        );
      })}
    </div>
  );
}

export function MaskDiffView({ diff, expanded }: { diff: MaskDiff; expanded: boolean }) {
  return (
    <div className={cn("flex flex-col gap-0 rounded-lg bg-(--primitive-opacity-black-alpha-75) p-2", !expanded && "max-h-72 overflow-hidden")}>
      <div className="flex items-start gap-2 rounded-t-sm bg-(--primitive-opacity-block-alpha-10) p-2">
        <span className="flex-none pt-0.5 font-mono text-caption-mono-c-rg text-red-300" aria-hidden>
          −
        </span>
        <DiffLines text={diff.before} masked={false} />
      </div>
      <div className="flex items-start gap-2 rounded-b-sm bg-(--primitive-opacity-allow-alpha-10) p-2">
        <span className="flex-none pt-0.5 font-mono text-caption-mono-c-rg text-green-500" aria-hidden>
          →
        </span>
        <DiffLines text={diff.after} masked />
      </div>
    </div>
  );
}
