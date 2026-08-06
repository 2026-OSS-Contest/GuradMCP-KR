"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { previewDetection } from "@/lib/api/client";
import type { DetectDirection, DetectionFinding, DetectionPreview } from "@/lib/api/types";
import { DETECTOR_SAMPLES, type DetectorSample } from "@/lib/detector-samples";
import { DetectorInput, MAX_BYTES } from "./detector-input";
import { DetectorResults } from "./detector-results";

/**
 * SCR-401 Detector (spec §5.4): paste or sample a text, run it through the detectors, and read
 * what was found beside what the text becomes once masked.
 *
 * `POST /detect/preview` is one of the few endpoints the control plane already serves, so this
 * screen talks to a real gateway when one is configured and to MSW otherwise.
 */
/** Spec §5.4: how long typing has to settle before the screen runs the text by itself. */
const DEBOUNCE_MS = 500;

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

  const run = useCallback(
    async (value: string, side: DetectDirection, signal?: AbortSignal) => {
      if (!value.trim()) return;
      setRunning(true);
      setFailed(false);
      try {
        const result = await previewDetection(value, side, signal);
        if (signal?.aborted) return;
        setPreview(result);
      } catch (error) {
        // An abort is this component replacing its own request, not a failure to report.
        if ((error as Error)?.name === "AbortError") return;
        setPreview(undefined);
        setFailed(true);
      } finally {
        if (!signal?.aborted) setRunning(false);
      }
    },
    []
  );

  /**
   * Spec §5.4 asks for both: the screen keeps up on its own while typing, and the button is
   * there for when it should go now. The pause is what makes the automatic half usable — a run
   * per keystroke would be a request per keystroke, and the highlights would strobe.
   */
  useEffect(() => {
    // Over the cap the button refuses the run, and the automatic half has to refuse it too —
    // otherwise typing past 64KB quietly posts what the button is there to prevent.
    if (!text.trim() || new TextEncoder().encode(text).length > MAX_BYTES) return;
    const controller = new AbortController();
    const timer = setTimeout(() => void run(text, direction, controller.signal), DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, direction, run]);

  const sample = (kind: DetectorSample) => edit(DETECTOR_SAMPLES[kind]);

  // Selecting the match is what scrolls the textarea to it, and shows which run of text it was.
  const revealFinding = (finding: DetectionFinding) => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(finding.start, finding.end);
  };

  // The two halves sit flush: the design gives the content area no gap and no outer padding, and
  // each column carries its own 24/16 inset instead. That is what makes the 488px button row fit
  // the 520px input column at 1280 without wrapping.
  //
  // The frames stop at 1024, where the results float over the input. Narrower than that the
  // overlay would sit on top of the run button and half the samples, so the two stack instead —
  // the design says nothing about that width, and covering the controls is not a reading of it.
  return (
    <div data-scr="SCR-401" className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
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
        onRun={() => void run(text, direction)}
        onSample={sample}
        inputRef={inputRef}
      />

      {/*
        An even split at 1280 (520/520) and 1920 (840/840). At 1024 the frame gives this panel no
        column of its own — it floats over the input's right side, which SCR-302 does at the same
        width, so it is the design's responsive rule rather than the composition artifact an
        earlier reading here took it for.
      */}
      <div className="flex min-h-100 flex-col gap-4 overflow-y-auto px-4 pb-6 lg:absolute lg:inset-y-6 lg:right-4 lg:min-h-0 lg:w-86.75 lg:rounded-(--primitive-radius-rounded-2xl) lg:bg-grayscale-950 lg:p-4 lg:ring-1 lg:shadow-xl lg:shadow-black/40 lg:ring-grayscale-800 xl:static xl:inset-auto xl:w-auto xl:flex-1 xl:overflow-visible xl:rounded-none xl:bg-transparent xl:px-4 xl:py-6 xl:shadow-none xl:ring-0">
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
