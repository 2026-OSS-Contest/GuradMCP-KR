// SPEC-POL-04 §7.1 (GMCP-77): `guardmcp bench run --dry-run-only` — replay a labeled-normal
// dataset through the real pipeline (detect -> scoreRisk -> evaluate) with every matched
// policy forced into the shadow group (`mode: "shadow-all"`, packages/policy-engine/src/
// index.ts's `evaluate()`), so a policy can be measured against real-shaped negatives before
// it ever risks acting on production traffic.
//
// FPR is per-policy but shares one denominator: §6.1's own worked example (`normalSampleCount:
// 1200, falsePositiveCount: 9, fpr: 0.0075`) is `9/1200` — the size of the *whole* labeled-
// normal dataset, not "how many of them this policy matched". §4.3's prose ("FPR 분모용")
// reads as the opposite at a glance, but computing every policy's FPR against how often it
// personally matched would make FPR trivially 1.0 for almost any policy that ever matches at
// all (a policy's own `action` is fixed and non-`allow`, so a match is definitionally an
// `allow`-would-not-have-happened event) — which is not a usable signal. The worked example is
// the actual wire contract, so it wins:
//   normalSampleCount (shared)  = every `label: false` sample in the dataset
//   falsePositiveCount (per policy) += 1 when the policy matched the sample at all
// (a match with a non-`allow` action is what "false positive" means here — §7.1 step 3's
// "매칭 verdict가 allow가 아니면"). `shadow-all` collapses the normal/shadow distinction for
// the *replay*, so a policy's own `action` is always the signal; there is no separate
// `dryRunVerdict` to prefer.
//
// This is a per-policy FPR measurement over one dataset's negatives — a different question
// from `runBenchmark()`'s detector-level FPR (attack-lab/benchmark/benchmark.ts), which stays
// untouched. Nothing here ever calls a policy's real action: `evaluationMode: "shadow-all"` is
// this benchmark's own parameter to `evaluate()`, never something an inbound Tool Call can set
// (see policy-engine's `EvaluationMode` doc comment).
import { readFile } from "node:fs/promises";
import { detect } from "../../packages/gateway/src/detect.js";
import { scoreRisk } from "../../packages/gateway/src/risk.js";
import { evaluate, type Direction, type EvaluationMode, type Policy, type ServerTrust } from "../../packages/policy-engine/src/index.js";

export interface DryRunBenchmarkSample {
  id: string;
  label: boolean;
  text: string;
}

export interface PolicyDryRunFprResult {
  policyId: string;
  /** How many of the dataset's normal samples this policy matched (with a non-`allow` action). */
  falsePositiveCount: number;
  /** `falsePositiveCount / normalSampleCount` (the dataset-wide count, shared by every policy);
   *  0 (not NaN) when the dataset has no normal samples at all. */
  fpr: number;
}

export interface DryRunBenchmarkReport {
  datasetPath: string;
  datasetVersion: string;
  mode: EvaluationMode;
  normalSampleCount: number;
  perPolicy: PolicyDryRunFprResult[];
}

export interface DryRunBenchmarkOptions {
  datasetPath: string;
  policies: Policy[];
  /** `"shadow-all"` (the `--dry-run-only` default) evaluates every policy as shadow, regardless
   *  of its own `dry_run`; `"normal"` measures only the policies actually marked `dry_run: true`
   *  (plus, incidentally, any real activation — a non-allow actionable match is still a
   *  meaningful FPR signal for that policy). */
  mode?: EvaluationMode;
  tool?: string;
  direction?: Direction;
  serverTrust?: ServerTrust;
}

export async function runDryRunBenchmark(options: DryRunBenchmarkOptions): Promise<DryRunBenchmarkReport> {
  const samples = JSON.parse(await readFile(options.datasetPath, "utf8")) as DryRunBenchmarkSample[];
  const normals = samples.filter((sample) => !sample.label);
  const mode = options.mode ?? "shadow-all";
  const tool = options.tool ?? "customer_lookup";
  const direction = options.direction ?? "response";
  const serverTrust = options.serverTrust ?? "untrusted";
  const policyById = new Map(options.policies.map((policy) => [policy.id, policy]));

  const falsePositiveCounts = new Map<string, number>();
  for (const sample of normals) {
    const detections = detect(sample.text);
    const riskScore = scoreRisk(detections, tool, serverTrust).score;
    const result = evaluate(
      options.policies,
      {
        direction,
        tool,
        serverTrust,
        args: {},
        detections: detections.map(({ type, subtype }) => ({ type, subtype })),
        riskScore
      },
      "allow",
      "severity-max",
      mode
    );
    const matchedIds = new Set([...result.matchedPolicyIds, ...result.dryRunMatchedPolicyIds]);
    for (const policyId of matchedIds) {
      const policy = policyById.get(policyId);
      if (!policy || policy.action === "allow") continue;
      falsePositiveCounts.set(policyId, (falsePositiveCounts.get(policyId) ?? 0) + 1);
    }
  }

  const normalSampleCount = normals.length;
  const perPolicy = [...falsePositiveCounts.entries()]
    .map(([policyId, falsePositiveCount]) => ({
      policyId,
      falsePositiveCount,
      fpr: normalSampleCount === 0 ? 0 : falsePositiveCount / normalSampleCount
    }))
    .sort((left, right) => left.policyId.localeCompare(right.policyId));

  return {
    datasetPath: options.datasetPath,
    datasetVersion: datasetVersionOf(options.datasetPath),
    mode,
    normalSampleCount,
    perPolicy
  };
}

/** No dataset in this repo declares its own version field, so the file's basename stands in for one. */
function datasetVersionOf(datasetPath: string): string {
  return datasetPath.split("/").at(-1) ?? datasetPath;
}
