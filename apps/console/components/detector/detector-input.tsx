"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Info } from "lucide-react";
import type { DetectDirection, DetectionFinding } from "@/lib/api/types";
import { toVerdict } from "@/lib/verdict";
import { cn } from "@/lib/utils";

/** Spec §5.4: the input is capped, and the counter reports bytes rather than characters. */
export const MAX_BYTES = 64 * 1024;

const TONE = {
  block: "text-verdict-block",
  warn: "text-verdict-warn",
  require_approval: "text-violet-100",
  allow: "text-verdict-allow"
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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div ref={hintRef} className="relative flex flex-none items-center gap-2">
        <span className="text-body-text-b3-md text-grayscale-300">{t("direction")}</span>
        <button
          type="button"
          onClick={() => setHint((previous) => !previous)}
          aria-expanded={hint}
          aria-label={t("directionHint")}
          className="flex size-4 flex-none items-center justify-center rounded-full text-grayscale-400 transition-colors hover:text-grayscale-200"
        >
          <Info className="size-4" aria-hidden />
        </button>
        {hint && (
          <span
            role="tooltip"
            className="absolute left-16 z-20 rounded-lg bg-grayscale-700 px-3 py-2 text-body-text-b3-md whitespace-nowrap text-grayscale-white shadow-lg"
          >
            {t("directionHint")}
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
              "flex h-9 items-center rounded-md px-4 font-mono text-body-mono-b2-rg transition-colors",
              direction === value
                ? "bg-(--primitive-opacity-white-alpha-10) text-grayscale-white"
                : "text-grayscale-400 hover:text-grayscale-200"
            )}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-grayscale-900">
        {/* Mirror layer: same metrics as the textarea, so a highlight lands on its word. */}
        <div
          ref={mirror}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden p-4 text-body-text-b2-md break-words whitespace-pre-wrap text-grayscale-white"
        >
          {segments(text, findings).map((part, index) =>
            part.finding ? (
              <mark
                key={index}
                className={cn(
                  "bg-(--primitive-opacity-white-alpha-6) underline decoration-2 underline-offset-4",
                  TONE[toVerdict(part.finding.action)]
                )}
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
          className="relative size-full resize-none bg-transparent p-4 text-body-text-b2-md break-words whitespace-pre-wrap text-transparent caret-white outline-none placeholder:text-grayscale-400"
        />
      </div>

      <div className="flex flex-none items-center gap-3 text-caption-text-c-rg text-grayscale-400">
        <span className="flex-1">{t("notStored")}</span>
        <span className={cn("flex-none font-mono", over && "text-verdict-block")}>
          {bytes}B/{MAX_BYTES / 1024}KB
        </span>
      </div>

      <div className="flex flex-none flex-wrap items-center gap-3">
        {(["pii", "secret", "injection"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => onSample(kind)}
            className="flex h-11 items-center rounded-xl bg-grayscale-800 px-5 text-body-text-b2-md text-grayscale-white transition-colors hover:bg-grayscale-700"
          >
            {t(`sample.${kind}`)}
          </button>
        ))}
        <button
          type="button"
          onClick={onRun}
          disabled={running || !text.trim() || over}
          className={cn(
            "ml-auto flex h-11 flex-none items-center rounded-xl bg-blue-800 px-6 text-body-text-b2-md text-grayscale-white transition-colors hover:bg-blue-700",
            (running || !text.trim() || over) && "cursor-not-allowed opacity-50"
          )}
        >
          {running ? t("running") : t("run")}
        </button>
      </div>
    </div>
  );
}
