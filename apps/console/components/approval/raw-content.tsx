import type { ContentLine } from "@/lib/api/types";

/**
 * The 마스킹 전 (Raw) pane of an approval card. Same `ContentLine` shape the masked pane uses —
 * a `mask` part is the run that masking would replace — but drawn as the value itself, underlined
 * in the block colour, because the point here is to show the operator exactly what would go out.
 *
 * Kept apart from `MaskedContent`, which SCR-301 renders with chips and a flex layout that drops
 * the spaces around each run; a raw line has to survive its own whitespace.
 */
export function RawContent({ lines }: { lines: ContentLine[] }) {
  return (
    <div className="flex flex-col gap-1 font-mono text-caption-mono-c-rg text-grayscale-200">
      {lines.map((line) => (
        <div key={line.no} className="flex gap-2">
          <span className="flex-none text-(--primitive-opacity-white-alpha-50)">{line.no}</span>
          <span className="min-w-0 break-all whitespace-pre-wrap">
            {line.parts.map((part, index) =>
              "mask" in part ? (
                <span key={index} className="text-verdict-block underline decoration-1 underline-offset-2">
                  {part.mask}
                </span>
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
