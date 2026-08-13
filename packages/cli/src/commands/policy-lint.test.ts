import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { policyLint } from "./policy-lint.js";

function policyYaml(overrides: Record<string, string> = {}): string {
  const fields: Record<string, string> = {
    id: "test_policy",
    pack: "test",
    version: "1",
    priority: "10",
    action: "block",
    severity: "high",
    ...overrides
  };
  return [
    `id: ${fields.id}`,
    `pack: ${fields.pack}`,
    `version: ${fields.version}`,
    `priority: ${fields.priority}`,
    "match:",
    "  direction: request",
    `action: ${fields.action}`,
    `severity: ${fields.severity}`,
    ""
  ].join("\n");
}

describe("guardmcp policy lint", () => {
  let dir: string;
  let output: string[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "guardmcp-lint-"));
    output = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    });
    process.exitCode = undefined;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it("passes a well-formed policy file", async () => {
    await writeFile(join(dir, "good.yaml"), policyYaml());
    await policyLint([dir]);
    expect(process.exitCode).toBeUndefined();
    expect(output.join("")).toContain("오류 없음");
  });

  it("flags an action outside the allowed set", async () => {
    await writeFile(join(dir, "bad.yaml"), policyYaml({ action: "not_a_real_action" }));
    await policyLint([dir]);
    expect(process.exitCode).toBe(1);
    expect(output.join("")).toContain("action:invalid_value");
  });

  it("flags a require_approval policy missing its approval block", async () => {
    await writeFile(join(dir, "approval.yaml"), policyYaml({ action: "require_approval" }));
    await policyLint([dir]);
    expect(process.exitCode).toBe(1);
    expect(output.join("")).toContain("approval 블록이 필요합니다");
  });

  it("flags an unsafe ReDoS-prone regex in match.args", async () => {
    const body = [
      "id: unsafe_regex_policy",
      "pack: test",
      "version: 1",
      "priority: 10",
      "match:",
      "  direction: request",
      "  args:",
      '    path_regex: "(a+)+$"',
      "action: block",
      "severity: high",
      ""
    ].join("\n");
    await writeFile(join(dir, "unsafe.yaml"), body);
    await policyLint([dir]);
    expect(process.exitCode).toBe(1);
    expect(output.join("")).toContain("unsafe_regex");
  });

  it("flags a duplicate policy id across two files in the linted set", async () => {
    const body = policyYaml({ id: "dup_id" });
    await writeFile(join(dir, "one.yaml"), body);
    await writeFile(join(dir, "two.yaml"), body);
    await policyLint([dir]);
    expect(process.exitCode).toBe(1);
    expect(output.join("")).toContain("id:duplicate");
  });

  it("rejects an unknown --pack name instead of silently linting nothing", async () => {
    await expect(policyLint(["--pack", "definitely-not-a-real-pack"])).rejects.toThrow(/알 수 없는 정책 팩/);
  });

  it("lints the shipped default pack cleanly via --pack", async () => {
    await policyLint(["--pack", "default"]);
    expect(process.exitCode).toBeUndefined();
    expect(output.join("")).toContain("오류 없음");
  });

  it("rejects a --pack directory with nothing to validate instead of reporting a clean pass", async () => {
    // loadPolicyPacks() loads an empty pack directory as zero policies / zero
    // errors (the right default for the gateway's boot-time loader), which
    // would otherwise print "no errors" for a pack this command never
    // actually read anything from.
    const emptyPackDir = join(process.cwd(), "policy-packs", `__guardmcp_lint_test_empty_${Date.now()}`);
    await mkdir(emptyPackDir, { recursive: true });
    try {
      await expect(policyLint(["--pack", emptyPackDir.split("/").pop() as string]))
        .rejects.toThrow(/검증할 정책 파일을 찾지 못했습니다/);
    } finally {
      await rm(emptyPackDir, { recursive: true, force: true });
    }
  });

  it("rejects using both <path-or-glob> and --pack together", async () => {
    await expect(policyLint([dir, "--pack", "default"])).rejects.toThrow(/use either/);
  });

  it("requires either a path or --pack", async () => {
    await expect(policyLint([])).rejects.toThrow(/guardmcp policy lint/);
  });
});
