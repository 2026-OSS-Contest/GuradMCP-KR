import injectionCatalog from "./rules/injection.json" with { type: "json" };
import piiCatalog from "./rules/pii.json" with { type: "json" };
import secretCatalog from "./rules/secret.json" with { type: "json" };

export type DetectionKind = "PII" | "SECRET" | "INJECTION";

export interface Detection {
  type: DetectionKind;
  subtype: string;
  maskedAs: string;
  start: number;
  end: number;
}

interface Rule {
  type: DetectionKind;
  subtype: string;
  pattern: RegExp;
  maskedAs: string;
  validate?: (value: string) => boolean;
}

interface NormalizedInput {
  text: string;
  sourceSpans: Array<{ start: number; end: number }>;
  identity: boolean;
}

const detectionKinds: readonly DetectionKind[] = ["PII", "SECRET", "INJECTION"];

/** Checksum helpers stay in code; the catalog references them by name. */
const validators: Record<string, (value: string) => boolean> = {
  luhn: validLuhn,
  koreanRrn: validRrnLike,
  koreanBizNo: validBizNo
};

const rules: Rule[] = [piiCatalog, secretCatalog, injectionCatalog].flatMap(parseCatalog);

export function detect(input: string): Detection[] {
  const normalized = normalizeInput(input);
  return rules.flatMap((rule) => findRule(rule, normalized));
}

export function mask(input: string, detections = detect(input)): string {
  return [...detections]
    .sort((left, right) => right.start - left.start)
    .reduce((result, detection) => `${result.slice(0, detection.start)}${detection.maskedAs}${result.slice(detection.end)}`, input);
}

/**
 * Parses one shipped rule catalog. Every failure throws at module load so a malformed
 * catalog stops the gateway instead of silently narrowing what the detector inspects.
 */
function parseCatalog(source: unknown): Rule[] {
  if (!isRecord(source)) throw new Error("Rule catalog must be an object.");
  const type = source.type;
  if (!isDetectionKind(type)) throw new Error(`Rule catalog declares an unknown type: ${String(type)}`);
  if (!Array.isArray(source.rules) || source.rules.length === 0) throw new Error(`${type} catalog must list at least one rule.`);
  const parsed = source.rules.map((entry) => parseRule(type, entry));
  const subtypes = new Set<string>();
  for (const { subtype } of parsed) {
    if (subtypes.has(subtype)) throw new Error(`${type} catalog repeats subtype ${subtype}.`);
    subtypes.add(subtype);
  }
  return parsed;
}

function parseRule(type: DetectionKind, entry: unknown): Rule {
  if (!isRecord(entry)) throw new Error(`${type} rule must be an object.`);
  const { subtype, description, pattern, flags, maskedAs, validate } = entry;
  if (!isNonEmptyString(subtype)) throw new Error(`${type} rule must declare a subtype.`);
  const label = `${type}.${subtype}`;
  if (!isNonEmptyString(description)) throw new Error(`${label} must document why it exists.`);
  if (!isNonEmptyString(pattern)) throw new Error(`${label} must declare a pattern.`);
  if (!isNonEmptyString(maskedAs)) throw new Error(`${label} must declare a mask tag.`);
  if (typeof flags !== "string" || !flags.includes("g")) throw new Error(`${label} must use the global flag.`);
  const compiled = compilePattern(label, pattern, flags);
  if (validate === undefined) return { type, subtype, pattern: compiled, maskedAs };
  if (!isNonEmptyString(validate)) throw new Error(`${label} declares a non-string validator.`);
  const validator = validators[validate];
  if (!validator) throw new Error(`${label} references an unknown validator: ${validate}`);
  return { type, subtype, pattern: compiled, maskedAs, validate: validator };
}

function compilePattern(label: string, pattern: string, flags: string): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch {
    throw new Error(`${label} declares a pattern that does not compile.`);
  }
}

function findRule(rule: Rule, input: NormalizedInput): Detection[] {
  const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
  return [...input.text.matchAll(pattern)]
    .filter((match) => match.index !== undefined && (!rule.validate || rule.validate(match[0])))
    .flatMap((match) => {
      if (input.identity) return [{
        type: rule.type,
        subtype: rule.subtype,
        maskedAs: rule.maskedAs,
        start: match.index,
        end: match.index + match[0].length
      }];
      const first = input.sourceSpans[match.index];
      const last = input.sourceSpans[match.index + match[0].length - 1];
      return first && last ? [{
        type: rule.type,
        subtype: rule.subtype,
        maskedAs: rule.maskedAs,
        start: first.start,
        end: last.end
      }] : [];
    });
}

function normalizeInput(input: string): NormalizedInput {
  if (isAscii(input)) return { text: input, sourceSpans: [], identity: true };
  const normalizedInput = input.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "");
  if (normalizedInput === input) return { text: input, sourceSpans: [], identity: true };
  let text = "";
  let sourceOffset = 0;
  const sourceSpans: NormalizedInput["sourceSpans"] = [];
  for (const symbol of input) {
    const sourceEnd = sourceOffset + symbol.length;
    const normalized = symbol.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "");
    text += normalized;
    for (let index = 0; index < normalized.length; index += 1) sourceSpans.push({ start: sourceOffset, end: sourceEnd });
    sourceOffset = sourceEnd;
  }
  return { text, sourceSpans, identity: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isDetectionKind(value: unknown): value is DetectionKind {
  return detectionKinds.some((kind) => kind === value);
}

function isAscii(input: string): boolean {
  for (let index = 0; index < input.length; index += 1) {
    if (input.charCodeAt(index) > 0x7f) return false;
  }
  return true;
}

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

function validLuhn(value: string): boolean {
  const number = digits(value);
  if (number.length < 13 || number.length > 19 || /^(\d)\1+$/.test(number)) return false;
  let sum = 0;
  let double = false;
  for (let index = number.length - 1; index >= 0; index -= 1) {
    const character = number[index];
    if (character === undefined) return false;
    let digit = Number(character);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function validRrnLike(value: string): boolean {
  const number = digits(value);
  const month = Number(number.slice(2, 4));
  const day = Number(number.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  const checksum = weights.reduce((sum, weight, index) => sum + Number(number[index]) * weight, 0);
  return (11 - (checksum % 11)) % 10 === Number(number[12]);
}

function validBizNo(value: string): boolean {
  const number = digits(value);
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  const sum = weights.reduce((total, weight, index) => total + Number(number[index]) * weight, 0)
    + Math.floor((Number(number[8]) * 5) / 10);
  return (10 - (sum % 10)) % 10 === Number(number[9]);
}
