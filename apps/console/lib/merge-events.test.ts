import { describe, expect, it } from "vitest";
import { mergeEvents } from "./merge-events";

interface Ev {
  id: string;
  at: number;
  from?: "stream" | "poll";
}

const opts = {
  getId: (e: Ev) => e.id,
  getTime: (e: Ev) => e.at,
  max: 20
};

describe("mergeEvents", () => {
  it("prepends a streamed event newest-first", () => {
    const prev: Ev[] = [{ id: "b", at: 2 }, { id: "a", at: 1 }];
    const merged = mergeEvents(prev, [{ id: "c", at: 3 }], opts);
    expect(merged.map((e) => e.id)).toEqual(["c", "b", "a"]);
  });

  it("de-duplicates an event that arrives over both the stream and a later poll", () => {
    const prev: Ev[] = [{ id: "a", at: 1, from: "stream" }];
    // A recovery poll returns the same event id; it must collapse to a single row.
    const merged = mergeEvents(prev, [{ id: "a", at: 1, from: "poll" }], opts);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("a");
  });

  it("backfills a gap and re-sorts older polled events below newer streamed ones", () => {
    // While disconnected the stream missed b and c; the recovery poll carries them, but a newer
    // event d was streamed first. The result stays strictly newest-first.
    const prev: Ev[] = [{ id: "d", at: 4, from: "stream" }];
    const poll: Ev[] = [
      { id: "c", at: 3, from: "poll" },
      { id: "b", at: 2, from: "poll" },
      { id: "a", at: 1, from: "poll" }
    ];
    const merged = mergeEvents(prev, poll, opts);
    expect(merged.map((e) => e.id)).toEqual(["d", "c", "b", "a"]);
  });

  it("caps the list to max, dropping the oldest", () => {
    const prev: Ev[] = Array.from({ length: 20 }, (_, i) => ({ id: `e${i}`, at: 100 - i }));
    const merged = mergeEvents(prev, [{ id: "new", at: 999 }], { ...opts, max: 20 });
    expect(merged).toHaveLength(20);
    expect(merged[0].id).toBe("new");
    expect(merged.at(-1)?.id).toBe("e18"); // e19 (oldest) falls off
  });

  it("without getTime keeps incoming-first insertion order", () => {
    const prev: Ev[] = [{ id: "a", at: 1 }];
    const merged = mergeEvents(prev, [{ id: "b", at: 0 }], { getId: (e: Ev) => e.id, max: 20 });
    expect(merged.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("returns prev unchanged in identity of contents when incoming is empty", () => {
    const prev: Ev[] = [{ id: "a", at: 1 }];
    expect(mergeEvents(prev, [], opts).map((e) => e.id)).toEqual(["a"]);
  });
});
