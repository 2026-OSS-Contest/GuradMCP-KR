import type { RawLine } from "@/lib/api/types";

/**
 * The 마스킹 전 (Raw) pane of an approval card: what would actually go out, with the runs masking
 * would replace underlined in the block colour.
 *
 * Takes `RawLine`, not the `ContentLine` the masked pane opposite uses. There a part carries the
 * label that stands in for a value (`PHONE`); here it has to carry the value. Sharing one type
 * would leave the same field meaning opposite things depending on which pane read it.
 *
 * Kept apart from `MaskedContent` for a second reason: SCR-301 renders that with chips and a flex
 * layout that drops the spaces around each run, and a raw line has to survive its own whitespace.
 */
export function RawContent({ lines }: { lines: RawLine[] }) {
  return (
    <div className="flex flex-col gap-1 font-mono text-caption-mono-c-rg text-grayscale-200">
      {lines.map((line) => (
        <div key={line.no} className="flex gap-2">
          <span className="flex-none text-(--primitive-opacity-white-alpha-50)">{line.no}</span>
          <span className="min-w-0 break-all whitespace-pre-wrap">
            {line.parts.map((part, index) =>
              "sensitive" in part ? (
                <span key={index} className="text-verdict-block underline decoration-1 underline-offset-2">
                  {part.sensitive}
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
