// Attack Scenario Runner (GMCP-55, FR-LAB-01).
//
// The benchmark asks one question of each probe: did the detector see anything.
// That is not what the catalog claims. A scenario claims a *control point* — this
// detection, under this direction and server trust, reaches this policy and ends
// in this verdict. Checking that needs the Risk Scorer and the Decision Engine,
// not just the detector, which is what this runner adds.
//
// It drives the real modules (`detect`, `scoreRisk`, `decide`) rather than a copy
// of them, so a passing run says something about the shipped pipeline. The
// gateway's HTTP surface is deliberately not involved: a scenario has to be
// reproducible in CI with nothing running.
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { detect, type Detection } from "../../packages/gateway/src/detect.js";
import { explainDecision } from "../../packages/gateway/src/pipeline/explanation.js";
import type { Explanation, PolicyDecision } from "../../packages/gateway/src/pipeline/types.js";
import { runtimePolicyPacks } from "../../packages/gateway/src/policies.generated.js";
import { scoreRisk } from "../../packages/gateway/src/risk.js";
import { decide, type Action, type Direction, type Policy, type ServerTrust } from "../../packages/policy-engine/src/index.js";

/** Which side of the demo a run reproduces (§4.3, the "swap the endpoint" story). */
export type RunMode = "guarded" | "vulnerable";

export interface Probe {
  id: string;
  text: string;
  expectBlocked: boolean;
  /**
   * Tool-call arguments the probe carries. A policy that decides on
   * `args.path_regex` cannot fire against text alone, so a scenario whose
   * control point is an argument condition has to supply one.
   */
  args?: Record<string, unknown>;
}

export interface ScenarioControl {
  stage: string;
  context: { direction: Direction; tool: string; serverTrust: ServerTrust };
  detections: string[];
  policy: string | null;
  verdict: Action;
}

export interface Scenario {
  id: string;
  threat: string | null;
  kind: "attack" | "benign";
  title: string;
  expectedControl: ScenarioControl;
  automation:
    | { mode: "probe"; probes: string[] }
    | { mode: "manual"; reason: string; blockedBy: string };
}

export interface Catalog { version: number; threats: Array<{ id: string; name: string; owasp: string[] }>; scenarios: Scenario[] }

/** One probe executed through the pipeline, shaped for the Replay timeline (§8.4). */
export interface StepEvent {
  eventId: string;
  sessionId: string;
  ts: string;
  probeId: string;
  direction: Direction;
  toolName: string;
  /** Digest of the inspected text, never the text itself (NFR-04). */
  argsDigest: string;
  verdict: Action;
  riskScore: number;
  matchedPolicyIds: string[];
  decidingPolicyId: string | null;
  detections: Array<{ type: string; subtype: string; confidence: number; maskedAs: string }>;
  /** M3 DoD: every step carries its own reason, so Replay never reconstructs one. */
  explanation: Explanation;
}

export interface ScenarioRun {
  scenarioId: string;
  threat: string | null;
  title: string;
  kind: "attack" | "benign";
  mode: RunMode;
  expectedVerdict: Action;
  actualVerdict: Action;
  expectedPolicy: string | null;
  decidingPolicyId: string | null;
  /**
   * `pass` — the pipeline reached the claimed control point.
   * `gap` — the catalog names no policy (`policy: null`) and nothing produced the
   *   target verdict. Declared but not yet enforced, so it is reported, never
   *   silently counted as covered, and does not fail the run.
   * `fail` — a claimed control point did not hold. This is the regression signal.
   * `ungraded` — a vulnerable-mode run. There is no verdict to be right about when
   *   nothing inspected; the run exists to show what gets through.
   */
  grade: "pass" | "gap" | "fail" | "ungraded";
  passed: boolean;
  failures: string[];
  events: StepEvent[];
}

export interface SkippedScenario { scenarioId: string; reason: string; blockedBy: string }

export interface RunReport {
  generatedAt: string;
  sessionId: string;
  mode: RunMode;
  scenarios: ScenarioRun[];
  skipped: SkippedScenario[];
  summary: { total: number; passed: number; gaps: number; failed: number; skipped: number; blockedAttacks: number; attacks: number };
  passed: boolean;
}

const catalogUrl = new URL("../scenarios/catalog.json", import.meta.url);
const probeUrl = new URL("../scenarios/threats.json", import.meta.url);
/** The pack the gateway activates; running against a different one would prove nothing. */
const activePackName = "korean-pii";

export async function loadCatalog(): Promise<{ catalog: Catalog; probes: Map<string, Probe> }> {
  const catalog = JSON.parse(await readFile(catalogUrl, "utf8")) as Catalog;
  const probes = JSON.parse(await readFile(probeUrl, "utf8")) as Probe[];
  return { catalog, probes: new Map(probes.map((probe) => [probe.id, probe])) };
}

/**
 * Resolves the runtime policies for a pack, following `extends` the way the
 * gateway does so an inherited policy can still be the deciding one.
 */
export function activePolicies(packName = activePackName, seen = new Set<string>()): Policy[] {
  if (seen.has(packName)) throw new Error(`Policy-pack extends cycle at ${packName}`);
  const pack = runtimePolicyPacks[packName];
  if (!pack) throw new Error(`Unknown policy pack ${packName}`);
  const next = new Set(seen).add(packName);
  const inherited = pack.extends.flatMap((reference) => activePolicies(reference.split("@")[0] ?? reference, next));
  return [...new Map([...inherited, ...pack.policies].map((policy) => [policy.id, policy])).values()];
}

/**
 * Runs one probe through stages ③–⑥.
 *
 * `vulnerable` mode does not evaluate anything: it is the no-gateway path, and
 * the point of reproducing it is to show what reaches the Agent when nothing
 * inspects. Faking it with an `allow` verdict from a real evaluation would be a
 * different claim entirely.
 */
export function runProbe(probe: Probe, control: ScenarioControl, mode: RunMode, sessionId: string, policies: Policy[]): StepEvent {
  const { direction, tool, serverTrust } = control.context;
  const detections: Detection[] = mode === "guarded" ? detect(probe.text) : [];
  const riskScore = mode === "guarded" ? scoreRisk(detections, tool, serverTrust).score : 0;
  const pack = runtimePolicyPacks[activePackName];
  if (!pack) throw new Error(`Active policy pack ${activePackName} is unavailable`);

  const result = mode === "guarded"
    ? decide({
        event: { direction, toolName: tool, serverTrust, args: probe.args ?? {} },
        detections: detections.map(({ type, subtype }) => ({ type, subtype })),
        riskScore,
        activePolicies: policies,
        strategy: pack.evaluationStrategy,
        defaultAction: pack.defaultAction
      })
    : { verdict: "allow" as Action, matchedPolicyIds: [], decidingPolicyId: null, reason: "게이트웨이 미적용 — 검사 없음" };

  const deciding = policies.find(({ id }) => id === result.decidingPolicyId);
  const decision: PolicyDecision = {
    verdict: result.verdict,
    matchedPolicyIds: result.matchedPolicyIds,
    decidingPolicyId: result.decidingPolicyId,
    riskScore,
    severity: deciding?.severity ?? "info",
    reasonCode: deciding?.reasonCode ?? (deciding ? deciding.id.toUpperCase() : "NO_POLICY_MATCH"),
    message: result.reason,
    detections
  };

  return {
    eventId: randomUUID(),
    sessionId,
    ts: new Date().toISOString(),
    probeId: probe.id,
    direction,
    toolName: tool,
    argsDigest: createHash("sha256").update(probe.text).digest("hex").slice(0, 16),
    verdict: result.verdict,
    riskScore,
    matchedPolicyIds: result.matchedPolicyIds,
    decidingPolicyId: result.decidingPolicyId,
    detections: detections.map(({ type, subtype, confidence, maskedAs }) => ({ type, subtype, confidence, maskedAs })),
    explanation: explainDecision(decision)
  };
}

/**
 * Runs every probe of a scenario and grades the result against what the catalog
 * claims. The scenario verdict is the strongest one any probe produced, because a
 * scenario is stopped as soon as one of its forms is.
 */
export function runScenario(scenario: Scenario, probes: Map<string, Probe>, mode: RunMode, sessionId: string, policies: Policy[]): ScenarioRun {
  if (scenario.automation.mode !== "probe") throw new Error(`${scenario.id} has no probes to run`);
  const events = scenario.automation.probes.map((probeId) => {
    const probe = probes.get(probeId);
    if (!probe) throw new Error(`${scenario.id}: probe ${probeId} is not in threats.json`);
    return runProbe(probe, scenario.expectedControl, mode, sessionId, policies);
  });

  const actualVerdict = events.reduce<Action>((strongest, event) =>
    actionRank[event.verdict] > actionRank[strongest] ? event.verdict : strongest, "allow");
  const decidingPolicyId = events.find(({ verdict }) => verdict === actualVerdict)?.decidingPolicyId ?? null;

  const expected = scenario.expectedControl;
  const failures: string[] = [];
  // Only the guarded run is graded. The unguarded one has no verdict to be right
  // or wrong about — it exists to show the difference, and it is expected to let
  // an attack through.
  if (mode === "guarded") {
    if (actualVerdict !== expected.verdict) failures.push(`expected ${expected.verdict}, got ${actualVerdict}`);
    if (expected.policy !== null && decidingPolicyId !== expected.policy) {
      failures.push(`expected policy ${expected.policy} to decide, got ${decidingPolicyId ?? "none"}`);
    }
  }
  // A scenario that names no policy is describing a target, not a guarantee. Grading
  // it as a regression would make the run red for something never built; grading it
  // as a pass would claim coverage that does not exist. It is neither.
  const grade = mode === "vulnerable"
    ? "ungraded"
    : failures.length === 0 ? "pass" : expected.policy === null ? "gap" : "fail";

  return {
    scenarioId: scenario.id,
    threat: scenario.threat,
    title: scenario.title,
    kind: scenario.kind,
    mode,
    expectedVerdict: expected.verdict,
    actualVerdict,
    expectedPolicy: expected.policy,
    decidingPolicyId,
    grade,
    passed: grade !== "fail",
    failures,
    events
  };
}

export interface RunOptions { mode?: RunMode; only?: string[]; sessionId?: string }

export async function runCatalog(options: RunOptions = {}): Promise<RunReport> {
  const mode = options.mode ?? "guarded";
  const sessionId = options.sessionId ?? `attacklab-${randomUUID().slice(0, 8)}`;
  const { catalog, probes } = await loadCatalog();
  const policies = activePolicies();
  const selected = options.only?.length ? catalog.scenarios.filter(({ id, threat }) =>
    options.only!.includes(id) || (threat !== null && options.only!.includes(threat))) : catalog.scenarios;
  if (selected.length === 0) throw new Error(`No scenario matches ${options.only?.join(", ") ?? ""}`);

  const scenarios: ScenarioRun[] = [];
  const skipped: SkippedScenario[] = [];
  for (const scenario of selected) {
    if (scenario.automation.mode === "manual") {
      // Declared, not runnable. Counting it as a pass would be the exact claim
      // the catalog refuses to make (see docs/attack-scenarios.md).
      skipped.push({ scenarioId: scenario.id, reason: scenario.automation.reason, blockedBy: scenario.automation.blockedBy });
      continue;
    }
    scenarios.push(runScenario(scenario, probes, mode, sessionId, policies));
  }

  const attacks = scenarios.filter(({ kind }) => kind === "attack");
  const summary = {
    total: scenarios.length,
    passed: scenarios.filter(({ grade }) => grade === "pass").length,
    gaps: scenarios.filter(({ grade }) => grade === "gap").length,
    failed: scenarios.filter(({ grade }) => grade === "fail").length,
    skipped: skipped.length,
    blockedAttacks: attacks.filter(({ actualVerdict }) => actionRank[actualVerdict] >= actionRank.require_approval).length,
    attacks: attacks.length
  };
  return { generatedAt: new Date().toISOString(), sessionId, mode, scenarios, skipped, summary, passed: summary.failed === 0 };
}

/** Verdict strength (§5.3): block > require_approval > warn > mask_then_allow > allow. */
const actionRank: Record<Action, number> = { allow: 0, mask_then_allow: 1, warn: 2, require_approval: 3, block: 4 };
