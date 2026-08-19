// Benchmark Runner (§3.2 of docs/task-docs/GMCP-97/guardmcp-cli-design.md calls
// this "Benchmark Runner"; there is no separate service — this module *is* it).
//
// `runBenchmark()` holds all of the judgment logic; `run.ts` (npm run bench)
// and the `guardmcp bench` CLI command (GMCP-97) are both thin callers that
// serialize the same report, the same way attack-lab/runner/run.ts and the
// `guardmcp demo` command both call runCatalog() rather than reimplementing it.
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { parse } from "yaml";
import { readDryRunObservations, type DryRunObservations } from "./dryRunStats.js";
import { detect } from "../../packages/gateway/src/detect.js";
import { scoreRisk } from "../../packages/gateway/src/risk.js";
import { evaluate, type Action, type Detection, type Direction, type EvaluationStrategy, type Policy, type ServerTrust } from "../../packages/policy-engine/src/index.js";

interface Sample { id: string; label: boolean; text: string; type?: string }
/** FR-SEC-02: a domestic-credential sample names the entry it must trip, not just "some secret". */
interface KoreanServiceTokenSample { id: string; label: boolean; text: string; credential?: string }
/** FR-SEC-03: the entropy net has no vendor to name, so a sample only carries its verdict. */
interface EntropySample { id: string; label: boolean; text: string; note?: string }
/** FR-LAB-02: a Korean injection sample names the rule it must trip, plus the linguistic feature it probes. */
interface KoreanInjectionSample { id: string; label: boolean; text: string; subtype?: string; note?: string }
interface Scenario { id: string; text: string; expectBlocked: boolean }
interface AuthorFixture {
  id: string;
  coverage: { policy_id: string; expectation: "match" | "not_match" };
  event: {
    direction: Direction;
    tool: string;
    server_trust: ServerTrust;
    args?: Record<string, unknown>;
    detections: string[];
    risk_score: number;
  };
  expected: { action: string; matched_policy_ids: string[] };
}
interface PolicyPackManifest {
  name: string;
  default_action: Action;
  evaluation_strategy: EvaluationStrategy;
  extends?: string[];
  policies: string[];
}
interface LoadedPolicyPack { manifest: PolicyPackManifest; policies: Policy[] }

export interface BenchmarkThresholds {
  recall: number;
  fpr: number;
  p95Ms: number;
  blockRate: number;
  scenarioPassRate: number;
  fixturePassRate: number;
  fixtureCoverageRate: number;
  koreanServiceTokenRecall: number;
  koreanServiceTokenFpr: number;
  highEntropyRecall: number;
  highEntropyFpr: number;
  koreanInjectionRecall: number;
  koreanInjectionFpr: number;
}

export interface BenchmarkMetrics {
  recall: number;
  fpr: number;
  precision: number;
  p95Ms: number;
  averageMs: number;
  payloadBytes: number;
  blockRate: number;
  scenarioPassRate: number;
  fixturePassRate: number;
  fixtureCoverageRate: number;
  samples: number;
  positives: number;
  negatives: number;
  labeledTypeCount: number;
  threats: number;
  authorFixtures: number;
  policyCount: number;
  highEntropySamples: number;
  highEntropyRecall: number;
  highEntropyFpr: number;
  koreanServiceTokenSamples: number;
  koreanServiceTokenRecall: number;
  koreanServiceTokenFpr: number;
  koreanInjectionSamples: number;
  koreanInjectionRecall: number;
  koreanInjectionFpr: number;
  koreanInjectionSubtypes: number;
}

export interface BenchmarkReport {
  generatedAt: string;
  metrics: BenchmarkMetrics;
  thresholds: BenchmarkThresholds;
  perTypeRecall: Array<{ type: string; total: number; detected: number; recall: number }>;
  koreanServiceTokens: { samples: number; positives: number; negatives: number; recall: number; fpr: number; misses: unknown[] };
  highEntropySecrets: { samples: number; positives: number; negatives: number; recall: number; fpr: number; misses: unknown[] };
  koreanInjection: { samples: number; positives: number; negatives: number; recall: number; fpr: number; subtypeCoverage: string[]; misses: unknown[] };
  validationImpact: { fprWithoutValidation: number; fprWithValidation: number; falsePositivesPrevented: number; fprReduction: number };
  /** FR-LAB-03: dry-run activity observed on real traffic, or why none was. */
  dryRunObservations: DryRunObservations;
  contextWeightingImpact: { fprWithoutContext: number; fprWithContext: number; fprReduction: number; recallWithoutContext: number; recallWithContext: number; recallChange: number; falsePositivesPrevented: number };
  scenarios: Array<{ id: string; passed: boolean; expectedBlocked: boolean; actualBlocked: boolean }>;
  fixtures: Array<{ id: string; coverage: AuthorFixture["coverage"]; passed: boolean; expected: AuthorFixture["expected"]; actual: { action: Action; matched_policy_ids: string[] } }>;
  fixtureCoverage: Array<{ policyId: string; positive: boolean; negative: boolean }>;
  passed: boolean;
}

export async function runBenchmark(): Promise<BenchmarkReport> {
  const samples = JSON.parse(await readFile(new URL("../datasets/pii-benchmark.json", import.meta.url), "utf8")) as Sample[];
  const scenarios = JSON.parse(await readFile(new URL("../scenarios/threats.json", import.meta.url), "utf8")) as Scenario[];
  const koreanServiceTokenSamples = JSON.parse(await readFile(new URL("../datasets/korean-service-tokens.json", import.meta.url), "utf8")) as KoreanServiceTokenSample[];
  const entropySamples = JSON.parse(await readFile(new URL("../datasets/high-entropy-secrets.json", import.meta.url), "utf8")) as EntropySample[];
  const koreanInjectionSamples = JSON.parse(await readFile(new URL("../datasets/korean-injection.json", import.meta.url), "utf8")) as KoreanInjectionSample[];
  const policyRoot = fileURLToPath(new URL("../../policy-packs", import.meta.url));
  const fixtureRoot = fileURLToPath(new URL("../policy-fixtures", import.meta.url));
  const policyPacks = await loadPolicyPacks(policyRoot);
  const policies = [...policyPacks.values()].flatMap(({ policies: packPolicies }) => packPolicies);
  const policyById = new Map(policies.map((policy) => [policy.id, policy]));
  const bulkPiiMinCount = readBulkPiiMinCount(policyById);
  const authorFixtures = await loadYamlFiles<AuthorFixture>(fixtureRoot, (path) => [".yaml", ".yml"].includes(extname(path)));
  validateFixtures(authorFixtures, policies);

  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  /** FR-PII-02: how many benign samples the format validators keep out of the results. */
  let falsePositiveWithoutValidation = 0;
  /** FR-PII-04: how many benign samples the context weighting keeps out, and what it costs in recall. */
  let falsePositiveWithoutContext = 0;
  let falseNegativeWithoutContext = 0;
  const perTypeTotals = new Map<string, { total: number; detected: number }>();
  for (const sample of samples) {
    const subtypes = new Set(detect(sample.text).filter(({ type }) => type === "PII").map(({ subtype }) => subtype));
    const positive = subtypes.size > 0;
    if (!sample.label && detect(sample.text, { skipValidation: true }).some(({ type }) => type === "PII")) {
      falsePositiveWithoutValidation += 1;
    }
    const positiveWithoutContext = detect(sample.text, { skipContextWeighting: true }).some(({ type }) => type === "PII");
    if (!sample.label && positiveWithoutContext) falsePositiveWithoutContext += 1;
    if (sample.label && !positiveWithoutContext) falseNegativeWithoutContext += 1;
    if (sample.label && positive) truePositive += 1;
    if (!sample.label && positive) falsePositive += 1;
    if (sample.label && !positive) falseNegative += 1;
    if (sample.label && sample.type) {
      const entry = perTypeTotals.get(sample.type) ?? { total: 0, detected: 0 };
      entry.total += 1;
      if (subtypes.has(sample.type)) entry.detected += 1;
      perTypeTotals.set(sample.type, entry);
    }
  }
  const perTypeRecall = [...perTypeTotals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, { total, detected }]) => ({ type, total, detected, recall: detected / total }));
  const labeledTypeCount = perTypeRecall.length;

  const marker = " 010-1234-5678";
  const targetPayloadBytes = 10 * 1024;
  const tenKilobytes = `${"a".repeat(targetPayloadBytes - Buffer.byteLength(marker))}${marker}`;
  const timings = Array.from({ length: 300 }, () => {
    const start = performance.now();
    const pipelineDetections = detect(tenKilobytes);
    evaluate(policies, {
      direction: "response",
      tool: "customer_lookup",
      serverTrust: "untrusted",
      args: {},
      detections: pipelineDetections.map(({ type, subtype }) => ({ type, subtype })),
      riskScore: scoreRisk(pipelineDetections, "customer_lookup", "untrusted").score
    });
    return performance.now() - start;
  }).sort((left, right) => left - right);

  const scenarioResults = scenarios.map((scenario) => {
    const found = detect(scenario.text);
    // "Blocked" here means the detector produced a control point, and until T-08
    // every one of those was a SECRET or an INJECTION. Bulk personal data is the
    // exception: a single PII span is masked and delivered, so it is not a block,
    // while a dump of them is held for approval by `require_approval_bulk_pii_response`.
    // The threshold is that policy's `detections.min_count`; the two have to agree,
    // or this metric would score a control the pipeline does not actually apply.
    const actualBlocked =
      found.some(({ type }) => type === "SECRET" || type === "INJECTION") ||
      found.filter(({ type }) => type === "PII").length >= bulkPiiMinCount;
    return { id: scenario.id, passed: actualBlocked === scenario.expectBlocked, expectedBlocked: scenario.expectBlocked, actualBlocked };
  });
  const expectedThreats = scenarioResults.filter(({ expectedBlocked }) => expectedBlocked);
  const blocked = expectedThreats.filter(({ actualBlocked }) => actualBlocked).length;
  const fixtureResults = authorFixtures.map((fixture) => {
    const coveredPolicy = policyById.get(fixture.coverage.policy_id);
    if (!coveredPolicy) throw new Error(`${fixture.id}: coverage policy is unavailable.`);
    const pack = policyPacks.get(coveredPolicy.pack);
    if (!pack) throw new Error(`${fixture.id}: policy pack ${coveredPolicy.pack} is unavailable.`);
    const result = evaluate(resolvePackPolicies(coveredPolicy.pack, policyPacks), {
      direction: fixture.event.direction,
      tool: fixture.event.tool,
      serverTrust: fixture.event.server_trust,
      args: fixture.event.args ?? {},
      detections: fixture.event.detections.map(toDetection),
      riskScore: fixture.event.risk_score
    }, pack.manifest.default_action, pack.manifest.evaluation_strategy);
    // SPEC-POL-04 (GMCP-77): `result.matchedPolicyIds` is now ACTIONABLE-only — a shadow
    // (dry_run) policy that matched shows up in `result.dryRunMatchedPolicyIds` instead. A
    // fixture's job is "did this policy's match condition fire", which is true either way, so
    // coverage is checked against the union; `result.action` (never influenced by the shadow
    // group, §2.1) is still the actionable-only real verdict.
    const expectedIds = [...fixture.expected.matched_policy_ids].sort();
    const actualIds = [...result.matchedPolicyIds, ...result.dryRunMatchedPolicyIds].sort();
    return {
      id: fixture.id,
      coverage: fixture.coverage,
      passed: result.action === fixture.expected.action && JSON.stringify(actualIds) === JSON.stringify(expectedIds),
      expected: fixture.expected,
      actual: { action: result.action, matched_policy_ids: actualIds }
    };
  });
  const fixtureCoverage = policies.map(({ id }) => {
    const fixtures = fixtureResults.filter(({ coverage }) => coverage.policy_id === id);
    return {
      policyId: id,
      positive: fixtures.some(({ coverage, passed }) => coverage.expectation === "match" && passed),
      negative: fixtures.some(({ coverage, passed }) => coverage.expectation === "not_match" && passed)
    };
  });
  const positives = samples.filter(({ label }) => label).length;
  const negatives = samples.length - positives;
  const recall = truePositive / (truePositive + falseNegative);
  const fpr = falsePositive / negatives;
  const precision = truePositive / (truePositive + falsePositive);
  const p95Ms = timings[Math.ceil(timings.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
  /**
   * FR-SEC-02 (GMCP-71). Measured separately from the PII recall above rather than
   * folded into it: mixing the two would let a strong PII score hide a domestic
   * credential the detector stopped recognizing, and the whole claim of this file
   * is the one thing foreign scanners do not cover.
   *
   * A positive sample must trip the exact entry it names, so renaming an entry
   * without updating the dataset fails here instead of passing on a lucky match
   * from a different rule.
   */
  const koreanServiceTokenResults = koreanServiceTokenSamples.map((sample) => {
    const subtypes = new Set(detect(sample.text).map(({ subtype }) => subtype));
    const detected = sample.credential ? subtypes.has(sample.credential) : subtypes.size > 0;
    return { id: sample.id, label: sample.label, credential: sample.credential ?? null, detected, passed: detected === sample.label };
  });
  const koreanServiceTokenPositives = koreanServiceTokenResults.filter(({ label }) => label);
  const koreanServiceTokenNegatives = koreanServiceTokenResults.filter(({ label }) => !label);
  const koreanServiceTokens = {
    samples: koreanServiceTokenResults.length,
    positives: koreanServiceTokenPositives.length,
    negatives: koreanServiceTokenNegatives.length,
    recall: koreanServiceTokenPositives.length === 0
      ? 0
      : koreanServiceTokenPositives.filter(({ detected }) => detected).length / koreanServiceTokenPositives.length,
    fpr: koreanServiceTokenNegatives.length === 0
      ? 0
      : koreanServiceTokenNegatives.filter(({ detected }) => detected).length / koreanServiceTokenNegatives.length,
    misses: koreanServiceTokenResults.filter(({ passed }) => !passed).map(({ id, credential, detected }) => ({ id, credential, detected }))
  };

  /**
   * FR-SEC-03 (GMCP-72). The entropy net is the one detector that can fire on text
   * nobody wrote a pattern for, so its false-positive rate is the number that
   * decides whether it is usable at all — a net that flags every build log gets
   * turned off, and then it protects nothing.
   */
  const entropyResults = entropySamples.map((sample) => {
    const detected = detect(sample.text).some(({ subtype }) => subtype === "HIGH_ENTROPY");
    return { id: sample.id, label: sample.label, note: sample.note ?? null, detected, passed: detected === sample.label };
  });
  const entropyPositives = entropyResults.filter(({ label }) => label);
  const entropyNegatives = entropyResults.filter(({ label }) => !label);
  const highEntropySecrets = {
    samples: entropyResults.length,
    positives: entropyPositives.length,
    negatives: entropyNegatives.length,
    recall: entropyPositives.length === 0 ? 0 : entropyPositives.filter(({ detected }) => detected).length / entropyPositives.length,
    fpr: entropyNegatives.length === 0 ? 0 : entropyNegatives.filter(({ detected }) => detected).length / entropyNegatives.length,
    misses: entropyResults.filter(({ passed }) => !passed).map(({ id, note, detected }) => ({ id, note, detected }))
  };

  /**
   * FR-LAB-02 (GMCP-96). Kept out of the PII recall above for the same reason the two
   * blocks before it are: a strong PII score would otherwise hide Korean injection
   * phrasing the detector stopped recognizing.
   *
   * The negatives are the point of this dataset. Korean business writing names the
   * same nouns an attack uses — a QA document says 개발자 모드, a security policy says
   * 알리지 않고, a design review says 시스템 프롬프트 — so an FPR measured only against
   * unrelated text would report 0 while the detector fired on ordinary work.
   *
   * A positive must trip the exact subtype it names, so relaxing a rule until it
   * matches by luck from a different branch fails here instead of passing.
   */
  const koreanInjectionResults = koreanInjectionSamples.map((sample) => {
    const subtypes = new Set(detect(sample.text).filter(({ type }) => type === "INJECTION").map(({ subtype }) => subtype));
    const detected = sample.subtype ? subtypes.has(sample.subtype) : subtypes.size > 0;
    return { id: sample.id, label: sample.label, subtype: sample.subtype ?? null, note: sample.note ?? null, detected, passed: detected === sample.label };
  });
  const koreanInjectionPositives = koreanInjectionResults.filter(({ label }) => label);
  const koreanInjectionNegatives = koreanInjectionResults.filter(({ label }) => !label);
  const koreanInjection = {
    samples: koreanInjectionResults.length,
    positives: koreanInjectionPositives.length,
    negatives: koreanInjectionNegatives.length,
    recall: koreanInjectionPositives.length === 0
      ? 0
      : koreanInjectionPositives.filter(({ detected }) => detected).length / koreanInjectionPositives.length,
    fpr: koreanInjectionNegatives.length === 0
      ? 0
      : koreanInjectionNegatives.filter(({ detected }) => detected).length / koreanInjectionNegatives.length,
    subtypeCoverage: [...new Set(koreanInjectionPositives.map(({ subtype }) => subtype).filter((value): value is string => value !== null))].sort(),
    misses: koreanInjectionResults.filter(({ passed }) => !passed).map(({ id, subtype, note, detected }) => ({ id, subtype, note, detected }))
  };

  const thresholds: BenchmarkThresholds = { recall: 0.90, fpr: 0.05, p95Ms: 50, blockRate: 0.80, scenarioPassRate: 1, fixturePassRate: 1, fixtureCoverageRate: 1, koreanServiceTokenRecall: 0.90, koreanServiceTokenFpr: 0.05, highEntropyRecall: 0.90, highEntropyFpr: 0.05, koreanInjectionRecall: 0.90, koreanInjectionFpr: 0.05 };
  const metrics: BenchmarkMetrics = {
    recall,
    fpr,
    precision,
    p95Ms,
    averageMs: timings.reduce((sum, value) => sum + value, 0) / timings.length,
    payloadBytes: Buffer.byteLength(tenKilobytes),
    blockRate: expectedThreats.length === 0 ? 0 : blocked / expectedThreats.length,
    scenarioPassRate: scenarioResults.length === 0 ? 0 : scenarioResults.filter(({ passed }) => passed).length / scenarioResults.length,
    fixturePassRate: fixtureResults.length === 0 ? 1 : fixtureResults.filter(({ passed }) => passed).length / fixtureResults.length,
    fixtureCoverageRate: policies.length === 0 ? 0 : fixtureCoverage.filter(({ positive, negative }) => positive && negative).length / policies.length,
    samples: samples.length,
    positives,
    negatives,
    labeledTypeCount,
    threats: scenarios.length,
    authorFixtures: fixtureResults.length,
    policyCount: policies.length,
    highEntropySamples: highEntropySecrets.samples,
    highEntropyRecall: highEntropySecrets.recall,
    highEntropyFpr: highEntropySecrets.fpr,
    koreanServiceTokenSamples: koreanServiceTokens.samples,
    koreanServiceTokenRecall: koreanServiceTokens.recall,
    koreanServiceTokenFpr: koreanServiceTokens.fpr,
    koreanInjectionSamples: koreanInjection.samples,
    koreanInjectionRecall: koreanInjection.recall,
    koreanInjectionFpr: koreanInjection.fpr,
    koreanInjectionSubtypes: koreanInjection.subtypeCoverage.length
  };
  const passed = metrics.recall >= thresholds.recall
    && metrics.fpr <= thresholds.fpr
    && metrics.p95Ms <= thresholds.p95Ms
    && metrics.blockRate >= thresholds.blockRate
    && metrics.scenarioPassRate >= thresholds.scenarioPassRate
    && metrics.fixturePassRate >= thresholds.fixturePassRate
    && metrics.fixtureCoverageRate >= thresholds.fixtureCoverageRate
    && metrics.highEntropyRecall >= thresholds.highEntropyRecall
    && metrics.highEntropyFpr <= thresholds.highEntropyFpr
    && metrics.koreanServiceTokenRecall >= thresholds.koreanServiceTokenRecall
    && metrics.koreanServiceTokenFpr <= thresholds.koreanServiceTokenFpr
    && metrics.koreanInjectionRecall >= thresholds.koreanInjectionRecall
    && metrics.koreanInjectionFpr <= thresholds.koreanInjectionFpr;
  const fprWithoutValidation = negatives === 0 ? 0 : falsePositiveWithoutValidation / negatives;
  const validationImpact = {
    fprWithoutValidation,
    fprWithValidation: fpr,
    falsePositivesPrevented: falsePositiveWithoutValidation - falsePositive,
    fprReduction: fprWithoutValidation - fpr
  };
  /**
   * FR-PII-04 (GMCP-70). The ticket asks for an on/off record, and the pair only
   * means something if both halves are reported: a weighting that cut the false
   * positive rate by dropping real detections would show here as recall falling
   * on the "with" side, rather than as an unqualified improvement.
   */
  const fprWithoutContext = negatives === 0 ? 0 : falsePositiveWithoutContext / negatives;
  const recallWithoutContext = positives === 0 ? 0 : (positives - falseNegativeWithoutContext) / positives;
  const contextWeightingImpact = {
    fprWithoutContext,
    fprWithContext: fpr,
    fprReduction: fprWithoutContext - fpr,
    recallWithoutContext,
    recallWithContext: recall,
    recallChange: recall - recallWithoutContext,
    falsePositivesPrevented: falsePositiveWithoutContext - falsePositive
  };
  // Consulted, not required: the gate's own thresholds are all measured from the
  // datasets in this repository, so a benchmark run must not depend on a control plane
  // being reachable. CI has none, and its report says so rather than reporting zeros.
  const dryRunObservations = await readDryRunObservations(policies);
  return {
    generatedAt: new Date().toISOString(),
    metrics,
    thresholds,
    perTypeRecall,
    dryRunObservations,
    koreanServiceTokens,
    highEntropySecrets,
    koreanInjection,
    validationImpact,
    contextWeightingImpact,
    scenarios: scenarioResults,
    fixtures: fixtureResults,
    fixtureCoverage,
    passed
  };
}

/**
 * The bulk-disclosure threshold, read from the policy that enforces it rather than
 * repeated here (GMCP-119). The two numbers deciding the same thing from two files is
 * how this metric ends up scoring a control the pipeline does not actually apply: the
 * policy would escalate at one count while `blockRate` credited a block at another.
 *
 * Throws rather than defaulting. A silent fallback would keep the benchmark green
 * while measuring a threshold nothing enforces, which is the failure this exists to
 * prevent.
 */
export function readBulkPiiMinCount(policyById: Map<string, Policy>): number {
  const policyId = "require_approval_bulk_pii_response";
  const policy = policyById.get(policyId);
  if (!policy) throw new Error(`${policyId} is not among the shipped policies; blockRate cannot credit bulk PII.`);
  const minCount = policy.match?.detections?.min_count;
  if (typeof minCount !== "number" || !Number.isInteger(minCount) || minCount < 1) {
    throw new Error(`${policyId} must declare an integer match.detections.min_count of at least 1.`);
  }
  return minCount;
}

function toDetection(tag: string): Detection {
  const [type, ...subtype] = tag.split(".");
  return subtype.length > 0 ? { type: type ?? tag, subtype: subtype.join(".") } : { type: type ?? tag };
}

function validateFixtures(fixtures: AuthorFixture[], availablePolicies: Policy[]): void {
  const policyIds = new Set(availablePolicies.map(({ id }) => id));
  const fixtureIds = new Set<string>();
  for (const fixture of fixtures) {
    if (!fixture || typeof fixture !== "object") throw new Error("Policy fixture must be a YAML object.");
    if (typeof fixture.id !== "string" || fixture.id.length === 0) throw new Error("Policy fixture id must be a non-empty string.");
    if (fixtureIds.has(fixture.id)) throw new Error(`Duplicate policy fixture id: ${fixture.id}`);
    fixtureIds.add(fixture.id);
    const coverage = fixture.coverage;
    if (!coverage || !policyIds.has(coverage.policy_id)) throw new Error(`${fixture.id}: coverage.policy_id must reference a shipped policy.`);
    if (!(["match", "not_match"] as const).includes(coverage.expectation)) throw new Error(`${fixture.id}: coverage.expectation must be match or not_match.`);
    if (!fixture.event || !(["request", "response"] as const).includes(fixture.event.direction)) throw new Error(`${fixture.id}: invalid event.direction.`);
    if (typeof fixture.event.tool !== "string" || !(["trusted", "limited", "untrusted"] as const).includes(fixture.event.server_trust)) throw new Error(`${fixture.id}: invalid event tool or server_trust.`);
    if (!Array.isArray(fixture.event.detections) || !fixture.event.detections.every((tag) => typeof tag === "string")) throw new Error(`${fixture.id}: event.detections must be a string list.`);
    if (!Number.isFinite(fixture.event.risk_score) || fixture.event.risk_score < 0 || fixture.event.risk_score > 100) throw new Error(`${fixture.id}: event.risk_score must be 0..100.`);
    if (!fixture.expected || typeof fixture.expected.action !== "string" || !Array.isArray(fixture.expected.matched_policy_ids)) throw new Error(`${fixture.id}: invalid expected verdict.`);
    if (!fixture.expected.matched_policy_ids.every((id) => policyIds.has(id))) throw new Error(`${fixture.id}: expected verdict references an unknown policy.`);
    const coveredIdExpected = fixture.expected.matched_policy_ids.includes(coverage.policy_id);
    if ((coverage.expectation === "match") !== coveredIdExpected) throw new Error(`${fixture.id}: coverage expectation disagrees with expected.matched_policy_ids.`);
  }
}

async function loadYamlFiles<T>(root: string, include: (path: string) => boolean): Promise<T[]> {
  const paths = await walk(root);
  return Promise.all(paths.filter(include).map(async (path) => parse(await readFile(path, "utf8")) as T));
}

async function loadPolicyPacks(root: string): Promise<Map<string, LoadedPolicyPack>> {
  const manifests = (await walk(root)).filter((path) => ["pack.yaml", "pack.yml"].some((name) => path.endsWith(name)));
  const loaded = new Map<string, LoadedPolicyPack>();
  for (const manifestPath of manifests) {
    const manifest = parse(await readFile(manifestPath, "utf8")) as PolicyPackManifest;
    const packRoot = dirname(manifestPath);
    const packPolicies = await Promise.all(manifest.policies.map(async (relativePath) =>
      parse(await readFile(join(packRoot, relativePath), "utf8")) as Policy
    ));
    loaded.set(manifest.name, { manifest, policies: packPolicies });
  }
  return loaded;
}

function resolvePackPolicies(packName: string, packs: Map<string, LoadedPolicyPack>, resolving = new Set<string>()): Policy[] {
  if (resolving.has(packName)) throw new Error(`Policy-pack extends cycle at ${packName}`);
  const pack = packs.get(packName);
  if (!pack) throw new Error(`Unknown policy pack ${packName}`);
  const next = new Set(resolving).add(packName);
  const inherited = (pack.manifest.extends ?? []).flatMap((reference) => resolvePackPolicies(reference.split("@")[0] ?? reference, packs, next));
  return [...new Map([...inherited, ...pack.policies].map((policy) => [policy.id, policy])).values()];
}

async function walk(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map((entry) => {
    const child = join(root, entry.name);
    return entry.isDirectory() ? walk(child) : Promise.resolve([child]);
  }));
  return nested.flat();
}
