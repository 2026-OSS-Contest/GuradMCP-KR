import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoList, demoRun } from "./demo.js";

describe("guardmcp demo", () => {
  let output: string[];

  beforeEach(() => {
    output = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("demo list prints the full scenario catalog", async () => {
    await demoList();
    const text = output.join("");
    expect(text).toContain("A-01");
    expect(text).toContain("T-01");
  });

  it("demo run <id> matches its control point and leaves the exit code clean", async () => {
    await demoRun(["A-01"]);
    expect(process.exitCode).toBeUndefined();
    expect(output.join("")).toContain("PASS  A-01");
  });

  it("demo run --target vulnerable reproduces the attack getting through and never fails the run", async () => {
    await demoRun(["A-01", "--target", "vulnerable"]);
    expect(process.exitCode).toBeUndefined();
    const text = output.join("");
    expect(text).toContain("RUN   A-01");
    expect(text).toContain("this is the \"before\" side, so it should be 0");
  });

  it("demo run --seed pins the session id without needing --record", async () => {
    await demoRun(["A-01", "--seed", "42"]);
    expect(output.join("")).toContain("session attacklab-seed-42");
  });

  it("demo run rejects an unknown --target instead of silently defaulting", async () => {
    await expect(demoRun(["A-01", "--target", "bogus"])).rejects.toThrow(/--target must be guarded or vulnerable/);
  });

  it("demo run requires a scenario id", async () => {
    await expect(demoRun([])).rejects.toThrow(/guardmcp demo run/);
  });

  it("demo run rejects a scenario id that matches nothing in the catalog", async () => {
    await expect(demoRun(["NOT-A-SCENARIO"])).rejects.toThrow(/No scenario matches/);
  });
});
