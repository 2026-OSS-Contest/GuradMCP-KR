import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { parse } from "yaml";
import { detect } from "../../packages/gateway/src/detect.js";
import { evaluate, type Detection, type Direction, type Policy, type ServerTrust } from "../../packages/policy-engine/src/index.js";

interface Sample { id: string; label: boolean; text: string }
interface Scenario { id: string; text: string; expectBlocked: boolean }
interface AuthorFixture {
  id: string;
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
const fixtureRoot = fileURLToPath(new URL("../datasets", import.meta.url));
const policies = await loadYamlFiles<Policy>(policyRoot, (path) => path.includes(`${join("policies", "")}`) && [".yaml", ".yml"].includes(extname(path)));
const authorFixtures = await loadYamlFiles<AuthorFixture>(fixtureRoot, (path) => [".yaml", ".yml"].includes(extname(path)));

let truePositive = 0;
let falsePositive = 0;
let falseNegative = 0;
for (const sample of samples) {
  const positive = detect(sample.text).some(({ type }) => type === "PII");
  if (sample.label && positive) truePositive += 1;
  if (!sample.label && positive) falsePositive += 1;
  if (sample.label && !positive) falseNegative += 1;
}

const tenKilobytes = `${"정상 MCP 페이로드 ".repeat(640)} 010-1234-5678`.slice(0, 10 * 1024);
const timings = Array.from({ length: 300 }, () => {
  const start = performance.now();
  detect(tenKilobytes);
  return performance.now() - start;
}).sort((left, right) => left - right);

const blocked = scenarios.filter(({ text }) => detect(text).some(({ type }) => type === "SECRET" || type === "INJECTION")).length;
const fixtureResults = authorFixtures.map((fixture) => {
  const result = evaluate(policies, {
    direction: fixture.event.direction,
    tool: fixture.event.tool,
    serverTrust: fixture.event.server_trust,
    args: fixture.event.args ?? {},
    detections: fixture.event.detections.map(toDetection),
    riskScore: fixture.event.risk_score
  });
  const expectedIds = [...fixture.expected.matched_policy_ids].sort();
  const actualIds = [...result.matchedPolicyIds].sort();
  return {
    id: fixture.id,
    passed: result.action === fixture.expected.action && JSON.stringify(actualIds) === JSON.stringify(expectedIds),
    expected: fixture.expected,
    actual: { action: result.action, matched_policy_ids: result.matchedPolicyIds }
  };
});
const positives = samples.filter(({ label }) => label).length;
const negatives = samples.length - positives;
const recall = truePositive / (truePositive + falseNegative);
const fpr = falsePositive / negatives;
const precision = truePositive / (truePositive + falsePositive);
const p95Ms = timings[Math.ceil(timings.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
const thresholds = { recall: 0.90, fpr: 0.05, p95Ms: 50, blockRate: 0.80, fixturePassRate: 1 };
const metrics = {
  recall,
  fpr,
  precision,
  p95Ms,
  averageMs: timings.reduce((sum, value) => sum + value, 0) / timings.length,
  blockRate: blocked / scenarios.length,
  fixturePassRate: fixtureResults.length === 0 ? 1 : fixtureResults.filter(({ passed }) => passed).length / fixtureResults.length,
  samples: samples.length,
  positives,
  negatives,
  threats: scenarios.length,
  authorFixtures: fixtureResults.length
};
const passed = metrics.recall >= thresholds.recall
  && metrics.fpr <= thresholds.fpr
  && metrics.p95Ms <= thresholds.p95Ms
  && metrics.blockRate >= thresholds.blockRate
  && metrics.fixturePassRate >= thresholds.fixturePassRate;
const report = { generatedAt: new Date().toISOString(), metrics, thresholds, fixtures: fixtureResults, passed };

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!passed) process.exitCode = 1;

function toDetection(tag: string): Detection {
  const [type, ...subtype] = tag.split(".");
  return subtype.length > 0 ? { type: type ?? tag, subtype: subtype.join(".") } : { type: type ?? tag };
}

async function loadYamlFiles<T>(root: string, include: (path: string) => boolean): Promise<T[]> {
  const paths = await walk(root);
  return Promise.all(paths.filter(include).map(async (path) => parse(await readFile(path, "utf8")) as T));
}

async function walk(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map((entry) => {
    const child = join(root, entry.name);
    return entry.isDirectory() ? walk(child) : Promise.resolve([child]);
  }));
  return nested.flat();
}
