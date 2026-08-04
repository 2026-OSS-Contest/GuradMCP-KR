// Parse + validate a single `*.yaml` policy file (GMCP-14, FR-POL-02 §2).

import type { Policy } from "../types.js";
import { isSafePolicyRegex } from "../matcher.js";
import { loadError, type PolicyLoadError } from "./errors.js";
import { parseYamlWithSchema } from "./parseYaml.js";
import { policyFileSchema, type PolicyFileInput } from "./policySchema.js";

export interface ParsePolicyFileResult {
  policy?: Policy;
  errors: PolicyLoadError[];
}

export function parsePolicyFile(text: string, filePath: string): ParsePolicyFileResult {
  const { value, errors } = parseYamlWithSchema(text, filePath, policyFileSchema);
  if (!value) return { errors };

  // Precompile-time regex safety check (matcher.ts's documented loader
  // contract): reject ReDoS-prone or malformed `*_regex` args here so the
  // hot evaluation path never has to.
  const regexErrors = validateRegexes(value, filePath);
  if (regexErrors.length > 0) return { errors: regexErrors };

  return { policy: toPolicy(value), errors: [] };
}

/**
 * zod's `.optional()` output type keeps `| undefined` in the value position
 * of an optional key (so `version?: number | undefined`), which conflicts
 * with `Policy`'s `exactOptionalPropertyTypes`-checked `version?: number`
 * even though no key is ever actually set to `undefined` at runtime. A
 * JSON round-trip drops every such key outright — safe here because a
 * validated `Policy` is plain JSON-shaped data (no functions, dates, etc.).
 */
function toPolicy(value: PolicyFileInput): Policy {
  return JSON.parse(JSON.stringify(value)) as Policy;
}

function validateRegexes(policy: PolicyFileInput, filePath: string): PolicyLoadError[] {
  const args = policy.match.args;
  if (!args) return [];

  const errors: PolicyLoadError[] = [];
  for (const [key, raw] of Object.entries(args)) {
    if (!key.endsWith("_regex") || typeof raw !== "string") continue;
    if (!isSafePolicyRegex(raw)) {
      errors.push(
        loadError({
          file: filePath,
          ruleId: `match.args.${key}:unsafe_regex`,
          message: `match.args.${key} 정규식이 안전하지 않습니다 (ReDoS 위험이 있거나 허용되지 않는 구문입니다)`
        })
      );
    }
  }
  return errors;
}
