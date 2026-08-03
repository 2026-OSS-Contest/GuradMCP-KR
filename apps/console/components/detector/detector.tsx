"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { previewDetection } from "@/lib/api/client";
import type { DetectDirection, DetectionFinding, DetectionPreview } from "@/lib/api/types";
import { DETECTOR_SAMPLES, type DetectorSample } from "@/lib/detector-samples";
import { DetectorInput } from "./detector-input";
import { DetectorResults } from "./detector-results";

/**
 * SCR-401 Detector (spec §5.4): paste or sample a text, run it through the detectors, and read
 * what was found beside what the text becomes once masked.
 *
 * `POST /detect/preview` is one of the few endpoints the control plane already serves, so this
 * screen talks to a real gateway when one is configured and to MSW otherwise.
 */
export function Detector() {
  const t = useTranslations("detector");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [text, setText] = useState("");
  const [direction, setDirection] = useState<DetectDirection>("request");
  const [preview, setPreview] = useState<DetectionPreview | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);

  /** Editing invalidates the result, so stale highlights never sit over changed text. */
  const edit = (value: string) => {
    setText(value);
    setPreview(undefined);
    setFailed(false);
  };

  const run = async () => {
    if (!text.trim()) return;
    setRunning(true);
    setFailed(false);
    try {
      setPreview(await previewDetection(text, direction));
    } catch {
      setPreview(undefined);
      setFailed(true);
    } finally {
      setRunning(false);
    }
  };

  const sample = (kind: DetectorSample) => edit(DETECTOR_SAMPLES[kind]);

  // Selecting the match is what scrolls the textarea to it, and shows which run of text it was.
  const revealFinding = (finding: DetectionFinding) => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(finding.start, finding.end);
  };

  return (
    <div data-scr="SCR-401" className="flex min-h-0 flex-1 gap-6 px-8 py-6">
      <DetectorInput
        text={text}
        onTextChange={edit}
        direction={direction}
        onDirectionChange={(value) => {
          setDirection(value);
          // The verdicts differ by direction, so a result from the other one no longer applies.
          setPreview(undefined);
        }}
        findings={preview?.findings ?? []}
        running={running}
        onRun={() => void run()}
        onSample={sample}
        inputRef={inputRef}
      />

      {/* 420px at 1280 and up, shrinking rather than crowding the input at 1024. The 1024 frame
          draws this panel over the text, which reads as a composition artifact — the input is
          clipped behind it — so the columns stay side by side here. Worth a designer's check. */}
      <div className="flex min-h-0 w-105 max-w-[45%] min-w-80 flex-none flex-col gap-3">
        {failed && (
          <p role="status" className="flex-none text-body-text-b3-md text-grayscale-400">
            {t("error")}
          </p>
        )}
        <DetectorResults preview={preview} onSelectFinding={revealFinding} />
      </div>
    </div>
  );
}
