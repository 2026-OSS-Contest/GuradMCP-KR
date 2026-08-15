// Common error boundary for the inspection pipeline (NFR-03, GMCP-68 §4.1/§4.2).
//
// The spec sketches six stages (structural parse, three detectors, risk scorer, policy engine)
// wrapped by an async `runPipelineStage`. The real pipeline (`../server.ts` `evaluatePayload`)
// doesn't decompose that way: `detect()` (`../detect.ts`) already does structural parsing and
// secret/PII/injection detection together in one synchronous pass — there's no separate
// exported seam for each of those three — so `PipelineStage` names what the code actually calls
// as distinct steps instead of inventing boundaries `detect()` doesn't have.
//
// The pipeline is synchronous CPU work, not I/O, so a `Promise.race`-style timeout can never
// preempt a stage that's already running mid-call — the event loop is blocked on it. REQ-02's
// "타임아웃도 예외와 동일하게 취급" is implemented as an elapsed-time budget checked *between*
// stages instead: a stage that starts after the budget has already been exceeded is treated as
// timed out before it runs. This catches a pipeline that has fallen behind: it does not catch one
// stage taking 500ms all by itself, which would require moving that work off the main thread.
// One consequence: the *first* stage always runs (the clock starts at 0 when it's checked), so it
// can never itself be the one reported as `timedOut` — only a stage after a slow predecessor can.
export type PipelineStage = "detection" | "risk_scoring" | "policy_engine";

export interface StageError {
  stage: PipelineStage;
  errorClass: string;
  message: string;
  timedOut: boolean;
}

/** Carries the attributed {@link StageError} through the throw so the catching boundary doesn't have to re-derive which stage failed. */
export class PipelineStageError extends Error {
  constructor(readonly stageError: StageError) {
    super(stageError.message);
    this.name = "PipelineStageError";
  }
}

class PipelineBudgetExceededError extends Error {}

export const defaultStageBudgetMs = 500;

export interface StageBudgetTracker {
  /** Throws {@link PipelineBudgetExceededError} without calling `fn` if the budget is already spent. */
  run<T>(stage: PipelineStage, fn: () => T): T;
}

/** One tracker per pipeline run — the elapsed clock starts when the tracker is created. */
export function createStageBudgetTracker(budgetMs = defaultStageBudgetMs): StageBudgetTracker {
  const startedAt = performance.now();
  return {
    run<T>(stage: PipelineStage, fn: () => T): T {
      if (performance.now() - startedAt > budgetMs) {
        throw new PipelineBudgetExceededError(`pipeline exceeded ${budgetMs}ms budget before ${stage}`);
      }
      return fn();
    }
  };
}

/**
 * Runs `fn` under the tracker's budget, attributing any thrown error — including a budget
 * timeout — to `stage` via a thrown {@link PipelineStageError}. This is the single point every
 * pipeline stage funnels through (REQ-01): no stage decides for itself whether its own failure
 * is survivable.
 */
export function runStage<T>(tracker: StageBudgetTracker, stage: PipelineStage, fn: () => T): T {
  try {
    return tracker.run(stage, fn);
  } catch (error) {
    throw new PipelineStageError(toStageError(stage, error));
  }
}

function toStageError(stage: PipelineStage, error: unknown): StageError {
  const timedOut = error instanceof PipelineBudgetExceededError;
  return {
    stage,
    errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    message: timedOut ? error.message : summarizeError(error),
    timedOut
  };
}

/** NFR-04: never let a thrown error's message carry inspected payload text into the event/log. */
function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : "non-Error thrown";
}
