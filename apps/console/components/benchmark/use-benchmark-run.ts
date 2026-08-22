"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BenchmarkFixture, BenchmarkReport, BenchmarkSample, BenchmarkScenario } from "@/lib/api/types";

/** What a row was made from, so the dialog can show the whole case rather than the one line. */
export type RunSource =
  | { of: "sample"; sample: BenchmarkSample }
  | { of: "scenario"; scenario: BenchmarkScenario }
  | { of: "fixture"; fixture: BenchmarkFixture };

/** One row of the run: a dataset sample, an attack scenario, or a policy fixture. */
export interface RunRow {
  id: string;
  /** Which list it belongs to, for the group headings down the left. */
  section: "pii" | "injection" | "serviceToken" | "entropy" | "scenario" | "fixture";
  /** The subdivision under the section — a PII type, a credential name, a policy id. */
  kind: string | null;
  /** What was actually measured: the sample text, or the probe a scenario sends. */
  text: string;
  passed: boolean;
  source: RunSource;
}

/**
 * The rows in the order they are checked. Datasets first, in the order the runner reads them,
 * then the attack scenarios, then the policy fixtures — the same order `npm run bench` works in,
 * so the screen tells the same story the command does.
 */
/**
 * The chip a row wears — the sample's own subdivision, which every labelled positive has except
 * the high-entropy set: `high-entropy-secrets.json` is the one dataset that files its rows under
 * a prose note rather than a type, so its positives arrive with `kind: null` and would be the
 * only positives on the screen with nothing to show. They are named from their group rather than
 * from anything invented — the group *is* the category, and the run detects them as secrets.
 *
 * Negatives keep their empty chip on purpose. A chip here says "this row is a PHONE", and a
 * negative is not an instance of anything; it is a text the detector must leave alone. None of
 * the four datasets types them either.
 */
const chipFor = (sample: BenchmarkSample) =>
  sample.kind ?? (sample.label && sample.group === "entropy" ? "SECRET" : null);

export function toRows(samples: BenchmarkSample[], report: BenchmarkReport): RunRow[] {
  return [
    ...samples.map(
      (sample): RunRow => ({
        id: sample.id,
        section: sample.group,
        kind: chipFor(sample),
        text: sample.text,
        // A negative passes by not being detected; a positive passes by being detected.
        passed: sample.label ? sample.detected : !sample.detected,
        source: { of: "sample", sample }
      })
    ),
    ...report.scenarios.map(
      (scenario): RunRow => ({
        id: scenario.id,
        section: "scenario",
        kind: scenario.expectedBlocked ? "block" : "allow",
        // The probe, where the endpoint joined it in; the id alone otherwise.
        text: scenario.text ?? scenario.id,
        passed: scenario.passed,
        source: { of: "scenario", scenario }
      })
    ),
    ...report.fixtures.map(
      (fixture): RunRow => ({
        // The fixture's own id — long, because it names the case; the list truncates it and the
        // dialog has it whole. Every column then says something different: which case, what it
        // expects of the policy, and which policy that is.
        id: fixture.id,
        section: "fixture",
        kind: fixture.coverage.expectation,
        text: fixture.coverage.policy_id,
        passed: fixture.passed,
        source: { of: "fixture", fixture }
      })
    )
  ];
}

/**
 * How long the reading takes. The measurement itself is already in hand before the first frame —
 * this paces the *reading* of it, nothing else. Three and a half seconds is long enough to watch
 * and short enough to sit through twice.
 */
const DURATION_MS = 3_400;

export type RunState = "idle" | "running" | "done";

/**
 * Walks the rows so the checks can be watched arriving.
 *
 * Nothing here decides a verdict — every row already carries the one the runner gave it. The pace
 * is a reading aid, so a reader who has asked not to be animated gets the finished list at once
 * rather than a faster version of the same wait.
 *
 * How far it has got is read from the clock rather than counted in ticks. A fixed step per timer
 * callback makes the run take as long as the renders do: on a slow machine — CI, in the case that
 * found this — 245 rows re-rendering per tick stretched a 3.4s cascade past five seconds. Frames
 * may drop now, but the run still ends when it says it will.
 */
export function useBenchmarkRun(rows: RunRow[]) {
  const [state, setState] = useState<RunState>("idle");
  const [checked, setChecked] = useState(0);
  const frame = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(() => {
    if (rows.length === 0) return;
    stop();
    setChecked(0);
    setState("running");

    const reduced =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setChecked(rows.length);
      setState("done");
      return;
    }

    const started = performance.now();
    const step = () => {
      const elapsed = performance.now() - started;
      if (elapsed >= DURATION_MS) {
        stop();
        setChecked(rows.length);
        setState("done");
        return;
      }
      setChecked(Math.ceil((elapsed / DURATION_MS) * rows.length));
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, [rows.length, stop]);

  return { state, checked, start };
}
