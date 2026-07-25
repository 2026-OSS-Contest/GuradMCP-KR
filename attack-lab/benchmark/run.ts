import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { parse } from "yaml";
import { detect } from "../../packages/gateway/src/detect.js";
import { evaluate, type Action, type Detection, type Direction, type EvaluationStrategy, type Policy, type ServerTrust } from "../../packages/policy-engine/src/index.js";

interface Sample { id: string; label: boolean; text: string; type?: string }
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

const args = process.argv.slice(2);
const outputFlag = args.indexOf("--output");
const outputPath = resolve(
  outputFlag >= 0 && args[outputFlag + 1]
    ? args[outputFlag + 1] as string
    : process.env.GUARDMCP_BENCHMARK_REPORT ?? "reports/benchmark.json"
);

const samples = JSON.parse(await readFile(new URL("../datasets/pii-benchmark.json", import.meta.url), "utf8")) as Sample[];
const scenarios = JSON.parse(await readFile(new URL("../scenarios/threats.json", import.meta.url), "utf8")) as Scenario[];
const policyRoot = fileURLToPath(new URL("../../policy-packs", import.meta.url));
const fixtureRoot = fileURLToPath(new URL("../policy-fixtures", import.meta.url));
const policyPacks = await loadPolicyPacks(policyRoot);
const policies = [...policyPacks.values()].flatMap(({ policies: packPolicies }) => packPolicies);
const policyById = new Map(policies.map((policy) => [policy.id, policy]));
const authorFixtures = await loadYamlFiles<AuthorFixture>(fixtureRoot, (path) => [".yaml", ".yml"].includes(extname(path)));
validateFixtures(authorFixtures, policies);

let truePositive = 0;
let falsePositive = 0;
let falseNegative = 0;
/** FR-PII-02: how many benign samples the format validators keep out of the results. */
let falsePositiveWithoutValidation = 0;
const perTypeTotals = new Map<string, { total: number; detected: number }>();
for (const sample of samples) {
  const subtypes = new Set(detect(sample.text).filter(({ type }) => type === "PII").map(({ subtype }) => subtype));
  const positive = subtypes.size > 0;
  if (!sample.label && detect(sample.text, { skipValidation: true }).some(({ type }) => type === "PII")) {
    falsePositiveWithoutValidation += 1;
  }
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
    riskScore: Math.min(100, pipelineDetections.length * 35)
  });
  return performance.now() - start;
}).sort((left, right) => left - right);

const scenarioResults = scenarios.map((scenario) => {
  const actualBlocked = detect(scenario.text).some(({ type }) => type === "SECRET" || type === "INJECTION");
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
  const expectedIds = [...fixture.expected.matched_policy_ids].sort();
  const actualIds = [...result.matchedPolicyIds].sort();
  return {
    id: fixture.id,
    coverage: fixture.coverage,
    passed: result.action === fixture.expected.action && JSON.stringify(actualIds) === JSON.stringify(expectedIds),
    expected: fixture.expected,
    actual: { action: result.action, matched_policy_ids: result.matchedPolicyIds }
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
const thresholds = { recall: 0.90, fpr: 0.05, p95Ms: 50, blockRate: 0.80, scenarioPassRate: 1, fixturePassRate: 1, fixtureCoverageRate: 1 };
const metrics = {
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
  policyCount: policies.length
};
const passed = metrics.recall >= thresholds.recall
  && metrics.fpr <= thresholds.fpr
  && metrics.p95Ms <= thresholds.p95Ms
  && metrics.blockRate >= thresholds.blockRate
  && metrics.scenarioPassRate >= thresholds.scenarioPassRate
  && metrics.fixturePassRate >= thresholds.fixturePassRate
  && metrics.fixtureCoverageRate >= thresholds.fixtureCoverageRate;
const fprWithoutValidation = negatives === 0 ? 0 : falsePositiveWithoutValidation / negatives;
const validationImpact = {
  fprWithoutValidation,
  fprWithValidation: fpr,
  falsePositivesPrevented: falsePositiveWithoutValidation - falsePositive,
  fprReduction: fprWithoutValidation - fpr
};
const report = { generatedAt: new Date().toISOString(), metrics, thresholds, perTypeRecall, validationImpact, scenarios: scenarioResults, fixtures: fixtureResults, fixtureCoverage, passed };

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!passed) process.exitCode = 1;

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
