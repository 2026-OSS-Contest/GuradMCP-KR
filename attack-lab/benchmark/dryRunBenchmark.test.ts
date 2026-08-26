import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDryRunBenchmark } from "./dryRunBenchmark.js";
import type { Policy } from "../../packages/policy-engine/src/index.js";

let dir: string | undefined;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function datasetFile(samples: unknown[]): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "dry-run-benchmark-"));
  const path = join(dir, "dataset.json");
  await writeFile(path, JSON.stringify(samples));
  return path;
}

function policy(overrides: Partial<Policy> & Pick<Policy, "id" | "priority" | "action">): Policy {
  return { pack: "test", match: {}, severity: "medium", ...overrides };
}

describe("runDryRunBenchmark (SPEC-POL-04 §7.1)", () => {
  it("counts a dry_run block policy's matches/false-positives against normal (label: false) samples only", async () => {
    const datasetPath = await datasetFile([
      { id: "p1", label: true, text: "010-1234-5678로 전화해줘" },
      { id: "n1", label: false, text: "오늘 배포 버전은 1.2.3입니다" },
      { id: "n2", label: false, text: "회의는 오전 10시 30분에 시작합니다" }
    ]);

    const policies: Policy[] = [
      // Matches every text unconditionally (empty `match`), so it fires on both negatives.
      policy({ id: "shadow_block_everything", priority: 10, action: "block", dry_run: true })
    ];

    const report = await runDryRunBenchmark({ datasetPath, policies, mode: "shadow-all" });
    expect(report.normalSampleCount).toBe(2);
    expect(report.perPolicy).toEqual([{ policyId: "shadow_block_everything", falsePositiveCount: 2, fpr: 1 }]);
  });

  it("reports fpr 0 (not NaN) for a policy that never matched any normal sample", async () => {
    const datasetPath = await datasetFile([{ id: "n1", label: false, text: "회의는 오전 10시 30분에 시작합니다" }]);
    const policies: Policy[] = [
      policy({ id: "narrow_policy", priority: 10, action: "block", match: { tool: "never_matches" } })
    ];

    const report = await runDryRunBenchmark({ datasetPath, policies });
    expect(report.perPolicy).toEqual([]);
  });

  it("only scores label: false samples — a labeled attack sample never contributes to the FPR denominator or count", async () => {
    const datasetPath = await datasetFile([
      { id: "p1", label: true, text: "동일 텍스트" },
      { id: "n1", label: false, text: "동일 텍스트" }
    ]);
    const policies: Policy[] = [policy({ id: "always_matches", priority: 10, action: "warn" })];

    const report = await runDryRunBenchmark({ datasetPath, policies });
    expect(report.normalSampleCount).toBe(1);
    expect(report.perPolicy[0]?.falsePositiveCount).toBe(1);
  });

  it("every policy shares the same FPR denominator — the dataset's normal sample count, not its own match count", async () => {
    const datasetPath = await datasetFile([
      // Two samples carry a detectable phone number; the third carries nothing.
      { id: "n1", label: false, text: "고객 연락처는 010-1234-5678 입니다" },
      { id: "n2", label: false, text: "예약 확인 전화는 010-9876-5432 로 드립니다" },
      { id: "n3", label: false, text: "오늘 회의는 오전 10시입니다" }
    ]);
    const policies: Policy[] = [
      policy({ id: "matches_two_of_three", priority: 10, action: "block", match: { detections: { any_of: ["PII"] } } })
    ];

    const report = await runDryRunBenchmark({ datasetPath, policies, mode: "shadow-all" });
    expect(report.normalSampleCount).toBe(3);
    // Matches only 2 of the 3 samples, so this asserts fpr = falsePositiveCount /
    // normalSampleCount (2/3), not / its own match count (2/2, which would read as 1).
    expect(report.perPolicy).toEqual([
      { policyId: "matches_two_of_three", falsePositiveCount: 2, fpr: 2 / 3 }
    ]);
  });

  it("mode 'normal' only forces the policy's own dry_run/actionable status, not shadow-all", async () => {
    const datasetPath = await datasetFile([{ id: "n1", label: false, text: "회의는 오전 10시 30분에 시작합니다" }]);
    const actionable: Policy[] = [policy({ id: "actionable_warn", priority: 10, action: "warn" })];

    const report = await runDryRunBenchmark({ datasetPath, policies: actionable, mode: "normal" });
    // Still counted: an actionable policy matching a labeled-normal sample with a non-allow
    // action is itself a real false positive, independent of dry_run.
    expect(report.perPolicy).toEqual([{ policyId: "actionable_warn", falsePositiveCount: 1, fpr: 1 }]);
  });
});
