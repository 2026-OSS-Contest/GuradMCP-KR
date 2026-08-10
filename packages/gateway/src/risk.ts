import toolRiskCatalog from "./rules/tool-risk.json" with { type: "json" };
import riskWeightsConfig from "./rules/risk-weights.json" with { type: "json" };
import type { Detection, DetectionKind } from "./detect.js";

export type ToolRisk = "high" | "medium" | "low";
export type ServerTrust = "trusted" | "limited" | "untrusted";

/**
 * Verdict bands the console Risk Gauge draws. Policies express `risk_score.gte`
 * against these numbers, so a tuned score and the gauge always tell one story.
 */
export const riskThresholds = { warn: 40, approval: 70, block: 90 } as const;

/**
 * Why a score landed where it did; surfaced so a verdict can explain itself.
 * These factors combine into the pre-trust `baseScore`; server trust is then
 * applied as a multiplier (FR-GW-02 §4.3), not folded in as another addend.
 */
export interface RiskFactors {
  base: number;
  confidence: number;
  variety: number;
  tool: number;
  volume: number;
}

export interface RiskAssessment {
  score: number;
  /** Detection/tool score before the trust multiplier and untrusted floor are applied. */
  baseScore: number;
  toolRisk: ToolRisk;
  trustMultiplier: number;
  factors: RiskFactors;
}

interface ToolRiskRule {
  match: RegExp;
  risk: ToolRisk;
}

const toolRisks: readonly ToolRisk[] = ["high", "medium", "low"];

/**
 * A detection type sets the floor; an injection outranks a secret, which
 * outranks PII. SENSITIVE_FILE_PATH ranks below PII: it flags a filename
 * mention, not disclosed data, so it should never outweigh an actual PII or
 * secret span found alongside it (see detect.ts's DetectionKind comment).
 */
const detectionBase: Record<DetectionKind, number> = { INJECTION: 70, SECRET: 60, PII: 40, SENSITIVE_FILE_PATH: 20 };
const toolWeight: Record<ToolRisk, number> = { high: 15, medium: 8, low: 0 };
const varietyStep = 6;
const varietyCap = 12;
/** FR-PII-05: many personal-data spans in one payload read as bulk disclosure. */
const bulkVolume = { many: { count: 10, bonus: 15 }, some: { count: 5, bonus: 8 } };

const { rules: toolRiskRules, defaultRisk } = parseToolRiskCatalog(toolRiskCatalog);
const { trustMultiplier, untrustedHighRiskFloor } = parseRiskWeights(riskWeightsConfig);

/**
 * Pipeline step 5: fold detections and tool capability into a 0-100 base
 * score, then scale it by the target server's trust (FR-GW-02 §4.3). An empty
 * detection set scores 0 regardless of trust or tool — a call nothing was
 * found in must not inherit risk from its tool or its server.
 */
export function scoreRisk(detections: Detection[], tool: string, serverTrust: ServerTrust): RiskAssessment {
  const toolRisk = classifyTool(tool);
  const multiplier = trustMultiplier[serverTrust];
  const empty: RiskFactors = { base: 0, confidence: 0, variety: 0, tool: 0, volume: 0 };
  if (detections.length === 0) return { score: 0, baseScore: 0, toolRisk, trustMultiplier: multiplier, factors: empty };

  const dominant = detections.reduce((strongest, detection) =>
    detectionBase[detection.type] > detectionBase[strongest.type] ? detection : strongest);
  const base = detectionBase[dominant.type];
  const peakConfidence = Math.max(...detections
    .filter(({ type }) => type === dominant.type)
    .map(({ confidence }) => confidence));
  const distinctSubtypes = new Set(detections.map(({ type, subtype }) => `${type}.${subtype}`)).size;
  const piiSpans = detections.filter(({ type }) => type === "PII").length;

  const factors: RiskFactors = {
    base,
    // Catalog confidence nudges around a 0.8 baseline instead of scaling the
    // floor, so one weak signal cannot fall out of its type's band entirely.
    confidence: Math.round((peakConfidence - 0.8) * 20),
    variety: Math.min(varietyCap, (distinctSubtypes - 1) * varietyStep),
    tool: toolWeight[toolRisk],
    volume: piiSpans >= bulkVolume.many.count
      ? bulkVolume.many.bonus
      : piiSpans >= bulkVolume.some.count ? bulkVolume.some.bonus : 0
  };
  const baseScore = Math.max(0, Math.min(100, Object.values(factors).reduce((sum, value) => sum + value, 0)));
  let score = Math.max(0, Math.min(100, Math.round(baseScore * multiplier)));
  // Fail-safe: an untrusted server invoking a high-risk tool category (write,
  // send, delete, exec — reusing the tool-risk catalog's "high" band) never
  // scores below the floor once something was actually detected, even if the
  // detection itself was weak.
  if (serverTrust === "untrusted" && toolRisk === "high") score = Math.max(score, untrustedHighRiskFloor);
  return { score, baseScore, toolRisk, trustMultiplier: multiplier, factors };
}

/** First matching catalog entry wins, so list the most dangerous shapes first. */
export function classifyTool(tool: string): ToolRisk {
  return toolRiskRules.find(({ match }) => match.test(tool))?.risk ?? defaultRisk;
}

/**
 * Parses the shipped tool-risk catalog. Failures throw at module load so a
 * malformed entry stops the gateway rather than silently scoring tools as low.
 */
function parseToolRiskCatalog(source: unknown): { rules: ToolRiskRule[]; defaultRisk: ToolRisk } {
  if (!isRecord(source)) throw new Error("Tool-risk catalog must be an object.");
  if (source.version !== 1) throw new Error("Tool-risk catalog must declare version 1.");
  if (!isToolRisk(source.defaultRisk)) throw new Error("Tool-risk catalog must declare a valid defaultRisk.");
  if (!Array.isArray(source.tools) || source.tools.length === 0) throw new Error("Tool-risk catalog must list at least one tool.");
  const matches = new Set<string>();
  const rules = source.tools.map((entry) => {
    if (!isRecord(entry)) throw new Error("Tool-risk entry must be an object.");
    const { match, risk, description } = entry;
    if (typeof match !== "string" || match.length === 0) throw new Error("Tool-risk entry must declare a match pattern.");
    if (matches.has(match)) throw new Error(`Tool-risk catalog repeats the pattern ${match}.`);
    matches.add(match);
    if (!isToolRisk(risk)) throw new Error(`Tool-risk entry ${match} must declare high, medium, or low.`);
    if (typeof description !== "string" || description.length === 0) throw new Error(`Tool-risk entry ${match} must document why it exists.`);
    return { match: compileGlob(match), risk };
  });
  return { rules, defaultRisk: source.defaultRisk };
}

/**
 * Parses the shipped risk-weights config. Failures throw at module load, same
 * as the tool-risk catalog, so a malformed weight cannot silently under- or
 * over-score every call.
 */
function parseRiskWeights(source: unknown): { trustMultiplier: Record<ServerTrust, number>; untrustedHighRiskFloor: number } {
  if (!isRecord(source)) throw new Error("Risk-weights config must be an object.");
  if (source.version !== 1) throw new Error("Risk-weights config must declare version 1.");
  const grades: readonly ServerTrust[] = ["trusted", "limited", "untrusted"];
  const rawMultiplier = source.trustMultiplier;
  if (!isRecord(rawMultiplier)) throw new Error("Risk-weights config must declare trustMultiplier.");
  const trustMultiplier = {} as Record<ServerTrust, number>;
  for (const grade of grades) {
    const value = rawMultiplier[grade];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`Risk-weights config must declare a non-negative trustMultiplier.${grade}.`);
    }
    trustMultiplier[grade] = value;
  }
  const floor = source.untrustedHighRiskFloor;
  if (typeof floor !== "number" || !Number.isFinite(floor) || floor < 0 || floor > 100) {
    throw new Error("Risk-weights config must declare untrustedHighRiskFloor between 0 and 100.");
  }
  return { trustMultiplier, untrustedHighRiskFloor: floor };
}

function compileGlob(pattern: string): RegExp {
  const expression = [...pattern]
    .map((character) => character === "*" ? ".*" : /[.+^${}()|[\]\\?]/.test(character) ? `\\${character}` : character)
    .join("");
  return new RegExp(`^${expression}$`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToolRisk(value: unknown): value is ToolRisk {
  return toolRisks.some((risk) => risk === value);
}
