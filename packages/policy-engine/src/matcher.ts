// Policy match evaluation (GMCP-7, FR-POL-01).
//
// Evaluates a policy's `match` block against a Tool Call context and returns a
// boolean. This is the first stage of the Policy Engine pipeline; priority
// sorting, action selection, and severity-max adoption (FR-POL-02) live in
// `evaluate` (index.ts) / GMCP-12.
//
// Every condition is a pure function of (condition, context). An absent
// condition never contributes to the decision (returns `true`); all present
// conditions are combined with AND. `detections.any_of` is the sole OR axis.
//
// Regexes are validated (never re-shaped) and compiled fresh per call today;
// policies are few and short, so this stays well within the NFR-01 latency
// budget. Policy loaders are expected to pre-validate regexes with
// {@link isSafePolicyRegex}; the matcher additionally re-checks defensively.

import type { Detection, MatchDefinition, Policy, PolicyContext, ToolCallContext } from "./types.js";
import { basename, extractPathArg, normalizePath } from "./pathNormalize.js";

/**
 * Evaluate a full policy's match block against a Tool Call context.
 *
 * This is the entry point the Decision Engine (GMCP-12) calls per policy.
 */
export function matchesPolicy(policy: Policy, ctx: ToolCallContext): boolean {
  return matches(policy.match, ctx);
}

/** Evaluate a bare match block. All present conditions are AND-combined. */
export function matches(match: MatchDefinition, ctx: PolicyContext): boolean {
  return (
    matchDirection(match.direction, ctx) &&
    matchServerTrust(match.server_trust, ctx) &&
    matchTool(match.tool, ctx) &&
    matchArgs(match.args, ctx) &&
    matchDetections(match.detections, ctx) &&
    matchRiskScore(match.risk_score, ctx)
  );
}

// --- Per-condition sub-functions (spec §5) ---------------------------------

/** §5.1 — absent or `any` always matches; otherwise exact string compare. */
export function matchDirection(cond: MatchDefinition["direction"], ctx: PolicyContext): boolean {
  if (cond === undefined || cond === "any") return true;
  return cond === ctx.direction;
}

/** §5.2 — absent always matches; `*` is glob, otherwise exact (anchored). */
export function matchTool(cond: MatchDefinition["tool"], ctx: PolicyContext): boolean {
  if (cond === undefined) return true;
  return matchesGlob(cond, ctx.tool);
}

/** Trust-grade compare; absent or `any` always matches. */
export function matchServerTrust(cond: MatchDefinition["server_trust"], ctx: PolicyContext): boolean {
  if (cond === undefined || cond === "any") return true;
  return cond === ctx.serverTrust;
}

/** §5.6 — `riskScore >= gte` (and, for the runtime superset, `<= lte`). */
export function matchRiskScore(cond: MatchDefinition["risk_score"], ctx: PolicyContext): boolean {
  if (cond === undefined) return true;
  if (cond.gte !== undefined && ctx.riskScore < cond.gte) return false;
  if (cond.lte !== undefined && ctx.riskScore > cond.lte) return false;
  return true;
}

/**
 * §5.5 — matches when the intersection of context detections and `any_of` is
 * non-empty. A detection matches on its coarse type (`SECRET`) or its dotted
 * `type.subtype` token (`PII.RRN_LIKE`). An empty `any_of` is a policy error
 * (loader-filtered); the matcher treats it defensively as no match.
 * `all_of`/`none_of` are the runtime superset used by policy packs.
 */
export function matchDetections(cond: MatchDefinition["detections"], ctx: PolicyContext): boolean {
  if (cond === undefined) return true;
  const found = detectionTokens(ctx.detections);
  if (cond.any_of && !cond.any_of.some((type) => found.has(type))) return false;
  if (cond.all_of && !cond.all_of.every((type) => found.has(type))) return false;
  if (cond.none_of && cond.none_of.some((type) => found.has(type))) return false;
  return true;
}

/** Argument conditions (spec §5.3/§5.4 plus the runtime operator superset). */
export function matchArgs(cond: MatchDefinition["args"], ctx: PolicyContext): boolean {
  if (cond === undefined) return true;
  return matchesArgs(cond, ctx.args);
}

// --- Helpers ---------------------------------------------------------------

function detectionTokens(detections: Detection[]): Set<string> {
  return new Set(
    detections.flatMap(({ type, subtype }) => (subtype ? [type, `${type}.${subtype}`] : [type]))
  );
}

/**
 * Compile a glob to an anchored regex. Only `*` (zero+ of any char) and `?`
 * (one char) are meta; every other character is escaped, so a pattern like
 * `read_*` can never be tricked into matching `read_XevilX` by regex
 * injection, and `read_file` never partially matches `read_file_v2`.
 */
function matchesGlob(pattern: string, value: string): boolean {
  const expression = [...pattern]
    .map((character) => {
      if (character === "*") return ".*";
      if (character === "?") return ".";
      return /[.+^${}()|[\]\\]/.test(character) ? `\\${character}` : character;
    })
    .join("");
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
      // §5.3/FR-SEC-04 §3: a path target is normalized (URL-decode, NFKC,
      // null-byte truncation, `~`/`$HOME`, `.`/`..` resolution, lowercase —
      // see pathNormalize.ts) before matching, so obfuscated variants of the
      // same file resolve the same way; other `_regex` keys read the raw
      // field verbatim, since path semantics don't apply to them.
      if (key === "path") return matchesPathRegex(value, extractPathArg(actual));
      const target = actual[key];
      return (
        target !== undefined &&
        typeof value === "string" &&
        isSafePolicyRegex(value) &&
        new RegExp(value).test(String(target))
      );
    }
    if (condition.endsWith("_glob")) {
      const key = condition.slice(0, -"_glob".length);
      return actual[key] !== undefined && typeof value === "string" && matchesGlob(value, String(actual[key]));
    }
    if (condition.endsWith("_not_domain")) {
      const key = condition.slice(0, -"_not_domain".length);
      const domains = Array.isArray(value) ? value : [value];
      const target = actual[key];
      // §5.4: match when any recipient's domain is outside the list. Missing or
      // non-string `to` yields no recipients, so this condition does not match
      // (fail-open here; other defenses handle the malformed case).
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

/**
 * FR-SEC-04 §3.2: evaluate a `path_regex` against both the full normalized
 * path and its basename, so a nested credential file (`config/nested/.env`)
 * and a bare filename argument both resolve the same way.
 */
function matchesPathRegex(pattern: unknown, rawPath: string | undefined): boolean {
  if (rawPath === undefined || typeof pattern !== "string" || !isSafePolicyRegex(pattern)) return false;
  const { normalized } = normalizePath(rawPath);
  const regex = new RegExp(pattern);
  return regex.test(normalized) || regex.test(basename(normalized));
}

/**
 * Reject regex constructs that risk catastrophic backtracking (ReDoS) or
 * otherwise unsafe features before they are compiled at match time. Policy
 * loaders call this at load time; the matcher re-checks defensively.
 */
export function isSafePolicyRegex(pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > 512) return false;
  if (/\\[1-9]/.test(pattern) || pattern.includes("(?<=") || pattern.includes("(?<!")) return false;
  if (/(?:\([^)]*[|+*{][^)]*\))[+*{]/.test(pattern)) return false;
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

function domainMatches(target: string, allowedDomain: string): boolean {
  const normalizedAllowed = allowedDomain.toLowerCase().replace(/\.$/, "");
  const emailSeparator = target.lastIndexOf("@");
  let host = emailSeparator >= 0 ? target.slice(emailSeparator + 1) : target;
  try {
    host = new URL(target).hostname;
  } catch {
    /* Target may be an email address or bare host. */
  }
  const normalizedHost = host.toLowerCase().replace(/\.$/, "");
  return normalizedHost === normalizedAllowed || normalizedHost.endsWith(`.${normalizedAllowed}`);
}

function splitTargets(target: string): string[] {
  return target.split(/[,;]/).map((value) => value.trim()).filter(Boolean);
}
