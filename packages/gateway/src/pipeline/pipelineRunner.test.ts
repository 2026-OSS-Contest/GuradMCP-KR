import { describe, expect, it } from "vitest";
import { createStageBudgetTracker, PipelineStageError, runStage } from "./pipelineRunner.js";

describe("runStage", () => {
  it("returns the stage's value when it succeeds", () => {
    const tracker = createStageBudgetTracker();
    expect(runStage(tracker, "detection", () => 42)).toBe(42);
  });

  it("wraps a thrown error into a PipelineStageError attributed to that stage", () => {
    const tracker = createStageBudgetTracker();
    class BoomError extends Error {}
    let caught: unknown;
    try {
      runStage(tracker, "risk_scoring", () => {
        throw new BoomError("detector exploded");
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PipelineStageError);
    const stageError = (caught as PipelineStageError).stageError;
    expect(stageError.stage).toBe("risk_scoring");
    expect(stageError.errorClass).toBe("BoomError");
    expect(stageError.message).toBe("detector exploded");
    expect(stageError.timedOut).toBe(false);
  });

  it("wraps a non-Error throw without crashing", () => {
    const tracker = createStageBudgetTracker();
    let caught: unknown;
    try {
      runStage(tracker, "policy_engine", () => {
        throw "not an Error instance";
      });
    } catch (error) {
      caught = error;
    }
    const stageError = (caught as PipelineStageError).stageError;
    expect(stageError.errorClass).toBe("UnknownError");
    expect(stageError.message).toBe("non-Error thrown");
  });

  it("marks a stage as timed out when the tracker's budget is already spent before it runs", () => {
    const tracker = createStageBudgetTracker(-1); // already exceeded the instant it's created
    let ran = false;
    let caught: unknown;
    try {
      runStage(tracker, "detection", () => {
        ran = true;
      });
    } catch (error) {
      caught = error;
    }
    expect(ran).toBe(false); // the stage never runs once the budget is spent
    const stageError = (caught as PipelineStageError).stageError;
    expect(stageError.timedOut).toBe(true);
    expect(stageError.stage).toBe("detection");
  });

  it("lets later stages run normally when earlier ones stayed within budget", () => {
    const tracker = createStageBudgetTracker(10_000);
    expect(runStage(tracker, "detection", () => 1)).toBe(1);
    expect(runStage(tracker, "risk_scoring", () => 2)).toBe(2);
    expect(runStage(tracker, "policy_engine", () => 3)).toBe(3);
  });
});
