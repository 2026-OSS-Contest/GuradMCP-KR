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
export function toRows(samples: BenchmarkSample[], report: BenchmarkReport): RunRow[] {
  return [
    ...samples.map(
      (sample): RunRow => ({
        id: sample.id,
        section: sample.group,
        kind: sample.kind,
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
        id: fixture.id,
        section: "fixture",
        kind: fixture.coverage.policy_id,
        text: fixture.id,
        passed: fixture.passed,
        source: { of: "fixture", fixture }
      })
    )
  ];
}

/**
 * How fast the ticks run. The measurement itself takes under a second and the result is already
 * in hand before the first tick — this paces the *reading* of it, nothing else. 245 rows at 14ms
 * is a little over three seconds: long enough to watch, short enough to sit through twice.
 */
const STEP_MS = 14;

export type RunState = "idle" | "running" | "done";

/**
 * Walks the rows one at a time so the checks can be watched arriving.
 *
 * Nothing here decides a verdict — every row already carries the one the runner gave it. The pace
 * is a reading aid, so a reader who has asked not to be animated gets the finished list at once
 * rather than a faster version of the same wait.
 */
export function useBenchmarkRun(rows: RunRow[]) {
  const [state, setState] = useState<RunState>("idle");
  const [checked, setChecked] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
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

    // A step of one row per tick would take a frame each; stepping in proportion keeps the pace
    // the same however long the list grows.
    const perTick = Math.max(1, Math.ceil(rows.length / (3_400 / STEP_MS)));
    timer.current = setInterval(() => {
      setChecked((previous) => {
        const next = previous + perTick;
        if (next >= rows.length) {
          stop();
          setState("done");
          return rows.length;
        }
        return next;
      });
    }, STEP_MS);
  }, [rows.length, stop]);

  return { state, checked, start };
}
