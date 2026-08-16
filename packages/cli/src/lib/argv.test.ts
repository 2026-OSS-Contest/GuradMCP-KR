import { describe, expect, it } from "vitest";
import { readFlag, readPositionals, readValue } from "./argv.js";

describe("guardmcp CLI argv helpers", () => {
  it("reads a flag's value", () => {
    expect(readValue(["--target", "guarded"], "--target")).toBe("guarded");
    expect(readValue(["--target"], "--target")).toBeUndefined();
    expect(readValue([], "--target")).toBeUndefined();
  });

  it("reads a boolean flag's presence", () => {
    expect(readFlag(["--strict"], "--strict")).toBe(true);
    expect(readFlag([], "--strict")).toBe(false);
  });

  it("collects positionals while skipping known flags and their values", () => {
    const argv = ["A-01", "--target", "guarded", "--seed", "42"];
    expect(readPositionals(argv, ["--target", "--seed"])).toEqual(["A-01"]);
  });

  it("does not swallow a positional that happens to sit where a flag value would", () => {
    // "--pack" is a boolean-style presence flag here (no value token to skip).
    const argv = ["--pack", "korean-pii"];
    expect(readPositionals(argv, [], ["--pack"])).toEqual(["korean-pii"]);
  });
});
