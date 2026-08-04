import toolRiskCatalog from "./rules/tool-risk.json" with { type: "json" };
import type { Detection, DetectionKind } from "./detect.js";

export type ToolRisk = "high" | "medium" | "low";
export type ServerTrust = "trusted" | "limited" | "untrusted";

/**
 * Verdict bands the console Risk Gauge draws. Policies express `risk_score.gte`
 * against these numbers, so a tuned score and the gauge always tell one story.
 */
export const riskThresholds = { warn: 40, approval: 70, block: 90 } as const;

/** Why a score landed where it did; surfaced so a verdict can explain itself. */
export interface RiskFactors {
  base: number;
  confidence: number;
  variety: number;
  tool: number;
  trust: number;
  volume: number;
}

export interface RiskAssessment {
  score: number;
  toolRisk: ToolRisk;
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
const trustWeight: Record<ServerTrust, number> = { untrusted: 18, limited: 9, trusted: 0 };
const varietyStep = 6;
const varietyCap = 12;
/** FR-PII-05: many personal-data spans in one payload read as bulk disclosure. */
const bulkVolume = { many: { count: 10, bonus: 15 }, some: { count: 5, bonus: 8 } };

const { rules: toolRiskRules, defaultRisk } = parseToolRiskCatalog(toolRiskCatalog);

/**
 * Pipeline step 5: fold detections, tool capability, and server trust into one
 * 0-100 score that policies compare against. An empty detection set scores 0 —
 * a call nothing was found in must not inherit risk from its tool or its server.
 */
export function scoreRisk(detections: Detection[], tool: string, serverTrust: ServerTrust): RiskAssessment {
  const toolRisk = classifyTool(tool);
  const empty: RiskFactors = { base: 0, confidence: 0, variety: 0, tool: 0, trust: 0, volume: 0 };
  if (detections.length === 0) return { score: 0, toolRisk, factors: empty };

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
    trust: trustWeight[serverTrust],
    volume: piiSpans >= bulkVolume.many.count
      ? bulkVolume.many.bonus
      : piiSpans >= bulkVolume.some.count ? bulkVolume.some.bonus : 0
  };
  const total = Object.values(factors).reduce((sum, value) => sum + value, 0);
  return { score: Math.max(0, Math.min(100, total)), toolRisk, factors };
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
