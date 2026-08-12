import { describe, expect, it } from "vitest";
import {
  computeFingerprint,
  diffToolDefinitions,
  extractToolDefinitions,
  type ToolDefinitionLite,
  type ToolSnapshotBaselineEntry,
} from "./tool-snapshot.js";

function baseline(entries: (Partial<ToolSnapshotBaselineEntry> & { toolName: string })[]): ToolSnapshotBaselineEntry[] {
  return entries.map((entry) => ({
    description: "",
    inputSchema: {},
    fingerprint: computeFingerprint(entry.description ?? "", entry.inputSchema ?? {}),
    ...entry,
  }));
}

describe("computeFingerprint", () => {
  it("is independent of inputSchema key order", () => {
    const a = computeFingerprint("reads a file", {
      type: "object",
      properties: { path: { type: "string" }, encoding: { type: "string" } },
    });
    const b = computeFingerprint("reads a file", {
      type: "object",
      properties: { encoding: { type: "string" }, path: { type: "string" } },
    });
    expect(a).toBe(b);
  });

  it("is independent of nested object key order", () => {
    const a = computeFingerprint("x", { properties: { a: { type: "string", description: "d" } } });
    const b = computeFingerprint("x", { properties: { a: { description: "d", type: "string" } } });
    expect(a).toBe(b);
  });

  it("preserves array element order (arrays are not sorted)", () => {
    const a = computeFingerprint("x", { required: ["path", "mode"] });
    const b = computeFingerprint("x", { required: ["mode", "path"] });
    expect(a).not.toBe(b);
  });

  it("changes when description changes", () => {
    const a = computeFingerprint("reads a file", { type: "object" });
    const b = computeFingerprint("reads a file from a URL", { type: "object" });
    expect(a).not.toBe(b);
  });

  it("does not collide across the description/schema boundary", () => {
    const a = computeFingerprint("ab", "c");
    const b = computeFingerprint("a", "bc");
    expect(a).not.toBe(b);
  });
});

describe("diffToolDefinitions", () => {
  it("reports tool_added for a tool with no baseline entry", () => {
    const diffs = diffToolDefinitions([], [
      { name: "delete_file", description: "removes a file", inputSchema: { type: "object" } },
    ]);
    expect(diffs).toEqual([
      {
        toolName: "delete_file",
        diffType: "tool_added",
        before: null,
        after: { description: "removes a file", inputSchema: { type: "object" } },
      },
    ]);
  });

  it("reports tool_removed for a baseline tool absent from the current list", () => {
    const base = baseline([{ toolName: "read_file", description: "reads a file", inputSchema: { type: "object" } }]);
    const diffs = diffToolDefinitions(base, []);
    expect(diffs).toEqual([
      {
        toolName: "read_file",
        diffType: "tool_removed",
        before: { description: "reads a file", inputSchema: { type: "object" } },
        after: null,
      },
    ]);
  });

  it("reports description_changed when only the description differs", () => {
    const base = baseline([
      { toolName: "read_file", description: "파일 시스템에서 텍스트 파일을 읽는다.", inputSchema: { type: "object" } },
    ]);
    const current: ToolDefinitionLite[] = [
      { name: "read_file", description: "파일 시스템 경로 또는 원격 URL에서 콘텐츠를 읽는다.", inputSchema: { type: "object" } },
    ];
    const diffs = diffToolDefinitions(base, current);
    expect(diffs).toEqual([
      {
        toolName: "read_file",
        diffType: "description_changed",
        before: { description: "파일 시스템에서 텍스트 파일을 읽는다." },
        after: { description: "파일 시스템 경로 또는 원격 URL에서 콘텐츠를 읽는다." },
      },
    ]);
  });

  it("reports schema_changed when only inputSchema differs", () => {
    const base = baseline([
      { toolName: "read_file", description: "reads a file", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
    ]);
    const current: ToolDefinitionLite[] = [
      {
        name: "read_file",
        description: "reads a file",
        inputSchema: { type: "object", properties: { path: { type: "string" }, url: { type: "string" } } },
      },
    ];
    const diffs = diffToolDefinitions(base, current);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.diffType).toBe("schema_changed");
    expect(diffs[0]?.toolName).toBe("read_file");
  });

  it("reports two diffs when both description and inputSchema change", () => {
    const base = baseline([
      { toolName: "read_file", description: "reads a file", inputSchema: { type: "object", properties: {} } },
    ]);
    const current: ToolDefinitionLite[] = [
      {
        name: "read_file",
        description: "reads a file or a remote URL",
        inputSchema: { type: "object", properties: { url: { type: "string" } } },
      },
    ];
    const diffs = diffToolDefinitions(base, current);
    expect(diffs.map((diff) => diff.diffType).sort()).toEqual(["description_changed", "schema_changed"]);
  });

  it("reports nothing for an unchanged tool, even if the schema was rebuilt with different key order", () => {
    const base = baseline([
      { toolName: "read_file", description: "reads a file", inputSchema: { type: "object", properties: { a: 1, b: 2 } } },
    ]);
    const current: ToolDefinitionLite[] = [
      { name: "read_file", description: "reads a file", inputSchema: { type: "object", properties: { b: 2, a: 1 } } },
    ];
    expect(diffToolDefinitions(base, current)).toEqual([]);
  });

  it("handles a mix of added, removed, and changed tools in one pass", () => {
    const base = baseline([
      { toolName: "read_file", description: "reads a file", inputSchema: {} },
      { toolName: "legacy_tool", description: "old", inputSchema: {} },
    ]);
    const current: ToolDefinitionLite[] = [
      { name: "read_file", description: "reads a file, now with more power", inputSchema: {} },
      { name: "new_tool", description: "brand new", inputSchema: {} },
    ];
    const diffs = diffToolDefinitions(base, current);
    const byType = Object.fromEntries(diffs.map((diff) => [diff.diffType, diff.toolName]));
    expect(byType.tool_added).toBe("new_tool");
    expect(byType.tool_removed).toBe("legacy_tool");
    expect(byType.description_changed).toBe("read_file");
  });
});

describe("extractToolDefinitions", () => {
  it("reads a bare { tools } body", () => {
    const tools = extractToolDefinitions({ tools: [{ name: "read_file", description: "reads a file", inputSchema: { type: "object" } }] });
    expect(tools).toEqual([{ name: "read_file", description: "reads a file", inputSchema: { type: "object" } }]);
  });

  it("reads the MCP { result: { tools } } envelope", () => {
    const tools = extractToolDefinitions({ result: { tools: [{ name: "read_file", description: "reads a file" }] } });
    expect(tools).toEqual([{ name: "read_file", description: "reads a file", inputSchema: null }]);
  });

  it("skips a descriptor missing a string name or description", () => {
    const tools = extractToolDefinitions({ tools: [{ name: "ok", description: "fine" }, { description: "no name" }, { name: 5, description: "bad name type" }] });
    expect(tools).toEqual([{ name: "ok", description: "fine", inputSchema: null }]);
  });

  it("returns an empty list for a payload with no recognizable tool container", () => {
    expect(extractToolDefinitions({ error: "boom" })).toEqual([]);
    expect(extractToolDefinitions(null)).toEqual([]);
  });
});
