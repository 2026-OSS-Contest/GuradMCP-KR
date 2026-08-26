import { describe, expect, it } from "vitest";
import { displaySessionId } from "./session-id";

describe("displaySessionId", () => {
  it("shortens a control-plane UUID to its first group", () => {
    expect(displaySessionId("3f2a1b8c-4d5e-6f70-8192-a3b4c5d6e7f8")).toBe("3f2a1b8c");
  });

  it("accepts the uppercase form Jackson may serialise", () => {
    expect(displaySessionId("3F2A1B8C-4D5E-6F70-8192-A3B4C5D6E7F8")).toBe("3F2A1B8C");
  });

  it("leaves a short fixture id alone", () => {
    // Truncating `s-0712` would invent an ambiguity the id does not have.
    expect(displaySessionId("s-0712")).toBe("s-0712");
    expect(displaySessionId("s-0711")).toBe("s-0711");
  });

  it("leaves anything that is not a UUID alone rather than guessing", () => {
    expect(displaySessionId("3f2a1b8c")).toBe("3f2a1b8c");
    expect(displaySessionId("3f2a1b8c-4d5e")).toBe("3f2a1b8c-4d5e");
    expect(displaySessionId("not-a-uuid-at-all-but-quite-long")).toBe("not-a-uuid-at-all-but-quite-long");
    expect(displaySessionId("")).toBe("");
  });
});
