"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FieldInfoIcon } from "@/components/icons";
import type { DetectDirection, DetectionFinding } from "@/lib/api/types";
import { toVerdict } from "@/lib/verdict";
import { cn } from "@/lib/utils";

/** Spec §5.5: the input is capped, and the counter reports bytes rather than characters. */
export const MAX_BYTES = 64 * 1024;

/**
 * The prefix of `text` that fits the cap, cut on a character boundary.
 *
 * Slicing the encoded bytes can land mid-character — Korean runs three bytes each — and the
 * decoder marks such a tail with U+FFFD. Re-encoding is what tells a substituted one from a
 * U+FFFD that was in the text to begin with: the substitute grows the byte length past the cap,
 * an original cannot.
 */
export function clampToBytes(text: string, max = MAX_BYTES): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= max) return text;
  const cut = new TextDecoder().decode(bytes.subarray(0, max));
  return new TextEncoder().encode(cut).length > max ? cut.slice(0, -1) : cut;
}

// The matched runs are tinted and nothing more: the frame's own HTML renders each as a bare
// `<span style="color:…">`, so no ground and no underline. The two the design shows use the 300
// step rather than the 500 the verdict tokens point at — a lighter tint reads as emphasis inside
// a sentence, where the badge colours are meant to read as labels. The other two follow it.
const TONE = {
  block: "text-red-300",
  warn: "text-yellow-300",
  require_approval: "text-violet-100",
  allow: "text-green-300"
} as const;

/** Splits the text at the finding offsets so each match can carry its verdict's colour. */
function segments(text: string, findings: DetectionFinding[]) {
  const parts: { text: string; finding?: DetectionFinding }[] = [];
  let cursor = 0;
  for (const finding of findings) {
    if (finding.start < cursor) continue;
    if (finding.start > cursor) parts.push({ text: text.slice(cursor, finding.start) });
    parts.push({ text: text.slice(finding.start, finding.end), finding });
    cursor = finding.end;
  }
  parts.push({ text: text.slice(cursor) });
  return parts;
}

/**
 * The left half of SCR-401: the direction the text travels, the text itself with every finding
 * underlined in its verdict's colour, and the one-click samples.
 *
 * A textarea cannot colour its own content, so the highlights are a mirror layer sitting exactly
 * behind a transparent input — same font, padding and wrapping, so the two stay aligned.
 */
export function DetectorInput({
  text,
  onTextChange,
  direction,
  onDirectionChange,
  findings,
  running,
  onRun,
  onSample,
  inputRef
}: {
  text: string;
  onTextChange: (value: string) => void;
  direction: DetectDirection;
  onDirectionChange: (value: DetectDirection) => void;
  findings: DetectionFinding[];
  running: boolean;
  onRun: () => void;
  onSample: (kind: "pii" | "secret" | "injection") => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const t = useTranslations("detector");
  const [hint, setHint] = useState(false);
  const mirror = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);

  // The mirror has to follow the textarea's own scrolling, or the colours drift off the words.
  const syncScroll = () => {
    if (mirror.current && inputRef.current) mirror.current.scrollTop = inputRef.current.scrollTop;
  };

  useEffect(() => {
    if (!hint) return;
    const onDown = (event: MouseEvent) => {
      if (hintRef.current && !hintRef.current.contains(event.target as Node)) setHint(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setHint(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [hint]);

  const bytes = new TextEncoder().encode(text).length;
  const over = bytes > MAX_BYTES;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-6">
      <div ref={hintRef} className="relative flex flex-none items-center gap-2">
        <span className="text-body-text-b3-md text-grayscale-300">{t("direction")}</span>
        <button
          type="button"
          onClick={() => setHint((previous) => !previous)}
          aria-expanded={hint}
          aria-label={t("directionHint")}
          className="flex size-4 flex-none items-center justify-center rounded-full text-grayscale-400 transition-colors hover:text-grayscale-200"
        >
          <FieldInfoIcon className="size-4" aria-hidden />
        </button>
        {hint && (
          /*
            The design's Tooltip is a shared coach-mark: title, body, icon, a 확인 dismiss and
            `{n}/{n}` step pagination. This instance fills only the title — its body reads
            "서브 텍스트" and its pagination "{n}", both unfilled placeholders — so the dismiss
            is the one other part that is actually specified here.
          */
          <span
            role="tooltip"
            className="text-body-text-b3-md absolute left-16 z-20 flex items-center gap-10 rounded-lg bg-grayscale-700 py-1 pr-2 pl-3 whitespace-nowrap text-grayscale-white shadow-lg"
          >
            {t("directionHint")}
            <button
              type="button"
              onClick={() => setHint(false)}
              className="text-caption-text-c-rg flex-none cursor-pointer text-grayscale-300 transition-colors hover:text-grayscale-white"
            >
              {t("directionHintDismiss")}
            </button>
          </span>
        )}
      </div>

      <div className="flex flex-none items-center gap-1 self-start rounded-lg bg-grayscale-900 p-1">
        {(["request", "response"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onDirectionChange(value)}
            aria-pressed={direction === value}
            className={cn(
              "flex h-9 items-center rounded-md px-4 text-body-text-b2-md transition-colors",
              direction === value
                ? "bg-(--primitive-opacity-white-alpha-10) text-grayscale-white"
                : "text-grayscale-400 hover:text-grayscale-200"
            )}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-(--primitive-radius-rounded-xl) bg-grayscale-900">
        {/* Mirror layer: same metrics as the textarea, so a highlight lands on its word. */}
        <div
          ref={mirror}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden p-4 text-body-text-b3-md break-words whitespace-pre-wrap text-grayscale-white"
        >
          {segments(text, findings).map((part, index) =>
            part.finding ? (
              <mark
                key={index}
                // `mark` brings a yellow ground and black type of its own; the design wants
                // neither, so both are cleared rather than left to the user agent.
                className={cn("bg-transparent", TONE[toVerdict(part.finding.action)])}
              >
                {part.text}
              </mark>
            ) : (
              <span key={index}>{part.text}</span>
            )
          )}
        </div>

        <textarea
          ref={inputRef}
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          onScroll={syncScroll}
          placeholder={t("placeholder")}
          aria-label={t("inputLabel")}
          spellCheck={false}
          className="relative size-full resize-none bg-transparent p-4 text-body-text-b3-md break-words whitespace-pre-wrap text-transparent caret-white outline-none placeholder:text-grayscale-400"
        />
      </div>

      {/* Spec §5.5: past the cap the text is truncated and the truncation is announced. Saying
          which part went uninspected is the whole point of the warning — a silent cut would let
          "탐지 없음" stand for text nobody looked at. */}
      {over && (
        <p role="status" className="flex-none text-caption-text-c-rg text-verdict-block">
          {t("truncated", { limit: MAX_BYTES / 1024 })}
        </p>
      )}

      <div className="flex flex-none items-center gap-3 text-caption-text-c-rg text-grayscale-400">
        <span className="flex-1">{t("notStored")}</span>
        <span className={cn("flex-none font-mono", over && "text-verdict-block")}>
          {bytes}B/{MAX_BYTES / 1024}KB
        </span>
      </div>

      {/* The design keeps all four on one row: 40px tall, 16px side padding, 12px apart, 488px
          across — which fits the 520px input column at 1280 without wrapping. */}
      <div className="flex flex-none flex-wrap items-center gap-3">
        {(["pii", "secret", "injection"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => onSample(kind)}
            className="flex h-10 flex-none items-center rounded-(--primitive-radius-rounded-xl) bg-grayscale-800 px-4 text-body-text-b2-md text-grayscale-white transition-colors hover:bg-grayscale-700"
          >
            {t(`sample.${kind}`)}
          </button>
        ))}
        <button
          type="button"
          onClick={onRun}
          disabled={running || !text.trim()}
          className={cn(
            "flex h-10 flex-none items-center rounded-(--primitive-radius-rounded-xl) bg-blue-800 px-4 text-body-text-b2-md text-grayscale-white transition-colors hover:bg-blue-700",
            (running || !text.trim()) && "cursor-not-allowed opacity-50"
          )}
        >
          {running ? t("running") : t("run")}
        </button>
      </div>
    </div>
  );
}
