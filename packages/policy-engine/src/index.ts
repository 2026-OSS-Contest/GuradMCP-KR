export const actions = ["allow", "mask_then_allow", "warn", "require_approval", "block"] as const;
export const severities = ["info", "low", "medium", "high", "critical"] as const;

export type Action = (typeof actions)[number];
export type Severity = (typeof severities)[number];
export type Direction = "request" | "response";
export type ServerTrust = "trusted" | "limited" | "untrusted";
export type EvaluationStrategy = "severity-max" | "first-match";

export interface Detection {
  type: string;
  subtype?: string;
}

export interface PolicyContext {
  direction: Direction;
  tool: string;
  serverTrust: ServerTrust;
  args: Record<string, unknown>;
  detections: Detection[];
  riskScore: number;
}

export interface MatchDefinition {
  direction?: Direction | "any";
  tool?: string;
  server_trust?: ServerTrust | "any";
  args?: Record<string, unknown>;
  detections?: { any_of?: string[]; all_of?: string[]; none_of?: string[] };
  risk_score?: { gte?: number; lte?: number };
}

export interface Policy {
  id: string;
  pack: string;
  version?: number;
  description?: string;
  priority: number;
  match: MatchDefinition;
  action: Action;
  severity: Severity;
  message?: string;
  enabled?: boolean;
  approval?: {
    timeout_seconds: number;
    on_timeout: "block";
    allow_masked_approval?: boolean;
  };
}

export interface EvaluationResult {
  action: Action;
  matchedPolicyIds: string[];
  policies: Policy[];
}

const actionWeight: Record<Action, number> = {
  allow: 0,
  mask_then_allow: 1,
  warn: 2,
  require_approval: 3,
  block: 4
};

export function evaluate(
  policies: Policy[],
  context: PolicyContext,
  defaultAction: Action = "allow",
  strategy: EvaluationStrategy = "severity-max"
): EvaluationResult {
  const matched = [...policies]
    .filter((policy) => policy.enabled !== false)
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
    .filter((policy) => matches(policy.match, context));

  const action = strategy === "first-match"
    ? matched[0]?.action ?? defaultAction
    : matched.reduce<Action>(
      (strongest, policy) => actionWeight[policy.action] > actionWeight[strongest] ? policy.action : strongest,
      defaultAction
    );

  return { action, matchedPolicyIds: matched.map(({ id }) => id), policies: matched };
}

export function matches(match: MatchDefinition, context: PolicyContext): boolean {
  if (match.direction && match.direction !== "any" && match.direction !== context.direction) return false;
  if (match.server_trust && match.server_trust !== "any" && match.server_trust !== context.serverTrust) return false;
  if (match.tool && !matchesGlob(match.tool, context.tool)) return false;
  if (match.args && !matchesArgs(match.args, context.args)) return false;
  if (match.detections && !matchesDetections(match.detections, context.detections)) return false;
  if (match.risk_score?.gte !== undefined && context.riskScore < match.risk_score.gte) return false;
  if (match.risk_score?.lte !== undefined && context.riskScore > match.risk_score.lte) return false;
  return true;
}

function matchesGlob(pattern: string, value: string): boolean {
  const expression = [...pattern].map((character) => {
    if (character === "*") return ".*";
    if (character === "?") return ".";
    return /[.+^${}()|[\]\\]/.test(character) ? `\\${character}` : character;
  }).join("");
  return new RegExp(`^${expression}$`).test(value);
}

function matchesArgs(expected: Record<string, unknown>, actual: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([condition, value]) => {
    if (condition.endsWith("_exists")) {
      const key = condition.slice(0, -"_exists".length);
      return typeof value === "boolean" && Object.hasOwn(actual, key) === value;
    }
    if (condition.endsWith("_regex")) {
      const key = condition.slice(0, -"_regex".length);
      return actual[key] !== undefined && typeof value === "string" && isSafePolicyRegex(value) && new RegExp(value).test(String(actual[key]));
    }
    if (condition.endsWith("_glob")) {
      const key = condition.slice(0, -"_glob".length);
      return actual[key] !== undefined && typeof value === "string" && matchesGlob(value, String(actual[key]));
    }
    if (condition.endsWith("_not_domain")) {
      const key = condition.slice(0, -"_not_domain".length);
      const domains = Array.isArray(value) ? value : [value];
      const target = actual[key];
      return typeof target === "string" && splitTargets(target).some((candidate) => !domains.some((domain) => domainMatches(candidate, String(domain))));
    }
    if (condition.endsWith("_domain")) {
      const key = condition.slice(0, -"_domain".length);
      const domains = Array.isArray(value) ? value : [value];
      const target = actual[key];
      const targets = typeof target === "string" ? splitTargets(target) : [];
      return targets.length > 0 && targets.every((candidate) => domains.some((domain) => domainMatches(candidate, String(domain))));
    }
    if (condition.endsWith("_not_in")) {
      const key = condition.slice(0, -"_not_in".length);
      return Array.isArray(value) && !value.includes(actual[key]);
    }
    if (condition.endsWith("_in")) {
      const key = condition.slice(0, -"_in".length);
      return Array.isArray(value) && value.includes(actual[key]);
    }
    return actual[condition] === value;
  });
}

export function isSafePolicyRegex(pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > 512) return false;
  if (/\\[1-9]/.test(pattern) || pattern.includes("(?<=") || pattern.includes("(?<!")) return false;
  if (/(?:\([^)]*[|+*{][^)]*\))[+*{]/.test(pattern)) return false;
  try { new RegExp(pattern); return true; } catch { return false; }
}

function domainMatches(target: string, allowedDomain: string): boolean {
  const normalizedAllowed = allowedDomain.toLowerCase().replace(/\.$/, "");
  const emailSeparator = target.lastIndexOf("@");
  let host = emailSeparator >= 0 ? target.slice(emailSeparator + 1) : target;
  try { host = new URL(target).hostname; } catch { /* Target may be an email address or bare host. */ }
  const normalizedHost = host.toLowerCase().replace(/\.$/, "");
  return normalizedHost === normalizedAllowed || normalizedHost.endsWith(`.${normalizedAllowed}`);
}

function splitTargets(target: string): string[] {
  return target.split(/[,;]/).map((value) => value.trim()).filter(Boolean);
}

function matchesDetections(
  expected: NonNullable<MatchDefinition["detections"]>,
  detections: Detection[]
): boolean {
  const found = new Set(detections.flatMap(({ type, subtype }) => subtype ? [type, `${type}.${subtype}`] : [type]));
  if (expected.any_of && !expected.any_of.some((type) => found.has(type))) return false;
  if (expected.all_of && !expected.all_of.every((type) => found.has(type))) return false;
  if (expected.none_of && expected.none_of.some((type) => found.has(type))) return false;
  return true;
}
