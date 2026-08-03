import bankAccountTable from "./rules/bank-accounts.json" with { type: "json" };
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
  confidence: number;
}

/** What a rule does when its format validator rejects a candidate span. */
type ValidationFailure = "reject" | "downgrade";

interface Rule {
  type: DetectionKind;
  subtype: string;
  pattern: RegExp;
  maskedAs: string;
  confidence: number;
  validate?: (value: string) => boolean;
  onValidationFailure: ValidationFailure;
  /** Confidence kept when a `downgrade` rule fails validation. */
  unvalidatedConfidence: number;
}

/** Options for a single detection pass. */
export interface DetectOptions {
  /** Skips format validators; used to measure how much they reduce false positives. */
  skipValidation?: boolean;
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
  koreanBizNo: validBizNo,
  koreanBankAccount: validBankAccount
};

const rules: Rule[] = [piiCatalog, secretCatalog, injectionCatalog].flatMap(parseCatalog);
const injectionRules = rules.filter(({ type }) => type === "INJECTION");
const bankAccounts = parseBankAccountTable(bankAccountTable);

export function detect(input: string, options: DetectOptions = {}): Detection[] {
  const normalized = normalizeInput(input);
  const skipValidation = options.skipValidation === true;
  return [
    ...rules.flatMap((rule) => findRule(rule, normalized, skipValidation)),
    ...findEncodedInjections(normalized, skipValidation)
  ];
}

// --- Base64 de-obfuscation (GMCP-8, FR-INJ-02, threat T-07) -------------------
//
// NFKC and zero-width stripping run in normalizeInput, but an instruction that is
// base64-encoded survives both: the detector sees one opaque token and nothing matches.
// So decode the encoded runs and re-run the injection rules on what comes out.
//
// This pass reads the *normalized* text for the same reason the rules do — a single
// zero-width character inside a blob would otherwise split the run and hide the
// instruction from the one pass that exists to reveal it. Spans are mapped back to
// original offsets through resolveSourceSpan, exactly as findRule does.
//
// Cost is bounded by a character budget rather than a segment count. A count lets an
// attacker spend the budget on harmless blobs and starve the real one; a budget makes
// many small candidates cheap and only a genuinely large volume of base64 exhaust it.
const encodedRun = /[A-Za-z0-9+/_-]{24,}={0,2}/g;
/** Size of one decode window; a run longer than this is swept in several windows. */
const encodedWindowLength = 4096;
/** Overlap between windows so an instruction straddling a boundary is still read. */
const encodedWindowOverlap = 256;
/** Total characters this pass will feed to the decoder for one payload. */
const encodedCharBudget = 64 * 1024;
/** Base64 packs 4 characters per 3 bytes, so a shifted blob needs its offset found. */
const alignments = [0, 1, 2, 3];

/**
 * Reports one detection per encoded run whose decoded text matches an injection rule.
 * The span points at the **encoded** run in the original payload, so masking replaces
 * the whole blob and the decoded instruction never reaches the caller (NFR-04).
 *
 * The subtype is `OBFUSCATED` rather than the rule that matched inside: the shipped
 * `block_untrusted_injection_response` policy already lists `INJECTION.OBFUSCATED`, so
 * this makes an existing policy axis real instead of introducing a parallel one.
 */
function findEncodedInjections(input: NormalizedInput, skipValidation: boolean): Detection[] {
  const found: Detection[] = [];
  // Every decode *attempt* is charged, including the ones that fail — otherwise a
  // payload full of undecodable base64 costs unbounded work while appearing to respect
  // the ceiling.
  const budget = { left: encodedCharBudget };
  for (const match of input.text.matchAll(encodedRun)) {
    if (budget.left <= 0) break;
    if (match.index === undefined) continue;
    const confidence = strongestEncodedConfidence(match[0], skipValidation, budget);
    if (confidence === undefined) continue;
    const span = input.identity
      ? { start: match.index, end: match.index + match[0].length }
      : resolveSourceSpan(input, match.index, match[0].length);
    if (span) found.push({ type: "INJECTION", subtype: "OBFUSCATED", maskedAs: "[INJECTION]", start: span.start, end: span.end, confidence });
  }
  return found;
}

/**
 * Sweeps the run in overlapping windows, decoding each at all four alignments, and
 * reports the strongest injection match.
 *
 * Both dimensions exist because each was a bypass on its own. Decoding only the head of
 * a long run let an attacker push the instruction past the cut with plain padding, so
 * the run is swept end to end. Decoding at one alignment let a one-to-three character
 * prefix shift every byte, so all four quantum offsets are tried. The character budget
 * caps the combined cost.
 */
function strongestEncodedConfidence(run: string, skipValidation: boolean, budget: { left: number }): number | undefined {
  let strongest: number | undefined;
  const step = encodedWindowLength - encodedWindowOverlap;
  for (let start = 0; start < run.length; start += step) {
    const window = run.slice(start, start + encodedWindowLength);
    for (const offset of alignments) {
      if (budget.left <= 0) return strongest;
      budget.left -= window.length - offset;
      const text = decodeBase64Text(window.slice(offset));
      if (text === undefined) continue;
      const confidence = strongestInjectionConfidence(text, skipValidation);
      if (confidence !== undefined && (strongest === undefined || confidence > strongest)) strongest = confidence;
    }
  }
  return strongest;
}

/**
 * Decodes a candidate run, or returns undefined when it is not base64-encoded text.
 * `atob` rejects malformed base64, which keeps non-base64 text out. Decoding is lenient
 * about the *bytes*, though: a strict UTF-8 pass threw away the whole candidate when a
 * few leading bytes were junk, which is exactly what a shifted or prefixed blob looks
 * like. Undecodable bytes become replacement characters instead, and the injection rules
 * still have to match real words for anything to be reported — so binary blobs and
 * hashes produce nothing rather than being rejected up front.
 *
 * base64url is accepted because it is the standard form in URLs and JWT-style payloads.
 */
function decodeBase64Text(candidate: string): string | undefined {
  const standard = candidate.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  // atob needs a length that is a valid base64 quantum; a stray trailing character
  // would otherwise throw and discard an otherwise decodable run.
  const usable = standard.slice(0, standard.length - (standard.length % 4 === 1 ? 1 : 0));
  try {
    const binary = atob(usable);
    if (binary.length < 8) return undefined;
    return new TextDecoder("utf-8").decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  } catch {
    return undefined;
  }
}

function strongestInjectionConfidence(text: string, skipValidation: boolean): number | undefined {
  const normalized = normalizeInput(text);
  const confidences = injectionRules.flatMap((rule) => findRule(rule, normalized, skipValidation)).map(({ confidence }) => confidence);
  return confidences.length === 0 ? undefined : Math.max(...confidences);
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
  const { subtype, description, pattern, flags, maskedAs, confidence, validate, onValidationFailure, unvalidatedConfidence } = entry;
  if (!isNonEmptyString(subtype)) throw new Error(`${type} rule must declare a subtype.`);
  const label = `${type}.${subtype}`;
  if (!isNonEmptyString(description)) throw new Error(`${label} must document why it exists.`);
  if (!isNonEmptyString(pattern)) throw new Error(`${label} must declare a pattern.`);
  if (!isNonEmptyString(maskedAs)) throw new Error(`${label} must declare a mask tag.`);
  if (typeof flags !== "string" || !flags.includes("g")) throw new Error(`${label} must use the global flag.`);
  if (typeof confidence !== "number" || !(confidence > 0 && confidence <= 1)) throw new Error(`${label} must declare a confidence in (0, 1].`);
  const compiled = compilePattern(label, pattern, flags);
  const base = { type, subtype, pattern: compiled, maskedAs, confidence, onValidationFailure: "reject" as ValidationFailure, unvalidatedConfidence: confidence };
  if (validate === undefined) {
    if (onValidationFailure !== undefined) throw new Error(`${label} sets onValidationFailure without a validator.`);
    return base;
  }
  if (!isNonEmptyString(validate)) throw new Error(`${label} declares a non-string validator.`);
  const validator = validators[validate];
  if (!validator) throw new Error(`${label} references an unknown validator: ${validate}`);
  if (onValidationFailure === undefined) return { ...base, validate: validator };
  if (onValidationFailure !== "reject" && onValidationFailure !== "downgrade") {
    throw new Error(`${label} must set onValidationFailure to reject or downgrade.`);
  }
  if (onValidationFailure === "reject") return { ...base, validate: validator };
  if (typeof unvalidatedConfidence !== "number" || !(unvalidatedConfidence > 0 && unvalidatedConfidence < confidence)) {
    throw new Error(`${label} must declare an unvalidatedConfidence in (0, ${confidence}).`);
  }
  return { ...base, validate: validator, onValidationFailure, unvalidatedConfidence };
}

/**
 * Korean bank accounts have no checksum, so the format check is a digit-count
 * table: a listed issuer prefix must match its own length, and anything else
 * has to land in the range every domestic account falls into.
 */
function parseBankAccountTable(source: unknown): { banks: Array<{ prefix: string; digits: number[] }>; minDigits: number; maxDigits: number } {
  if (!isRecord(source) || source.version !== 1) throw new Error("Bank-account table must declare version 1.");
  const fallback = source.fallback;
  if (!isRecord(fallback) || typeof fallback.minDigits !== "number" || typeof fallback.maxDigits !== "number") {
    throw new Error("Bank-account table must declare a fallback digit range.");
  }
  if (!Array.isArray(source.banks) || source.banks.length === 0) throw new Error("Bank-account table must list at least one bank.");
  const banks = source.banks.map((entry) => {
    if (!isRecord(entry)) throw new Error("Bank-account entry must be an object.");
    const { bank, prefix, digits: lengths, description } = entry;
    if (!isNonEmptyString(bank)) throw new Error("Bank-account entry must name its bank.");
    if (!isNonEmptyString(prefix) || !/^\d+$/.test(prefix)) throw new Error(`${bank} must declare a numeric prefix.`);
    if (!isNonEmptyString(description)) throw new Error(`${bank} must document its account shape.`);
    if (!Array.isArray(lengths) || lengths.length === 0 || !lengths.every((value) => typeof value === "number" && Number.isInteger(value) && value > 0)) {
      throw new Error(`${bank} must list at least one digit count.`);
    }
    return { prefix, digits: lengths as number[] };
  });
  return { banks, minDigits: fallback.minDigits, maxDigits: fallback.maxDigits };
}

function compilePattern(label: string, pattern: string, flags: string): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch {
    throw new Error(`${label} declares a pattern that does not compile.`);
  }
}

function findRule(rule: Rule, input: NormalizedInput, skipValidation: boolean): Detection[] {
  const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
  return [...input.text.matchAll(pattern)].flatMap((match) => {
    if (match.index === undefined) return [];
    // A failed format check either removes the span or keeps it at a lower
    // confidence. Masking rules prefer downgrade so a real identifier from an
    // unlisted issuer is never dropped outright.
    let confidence = rule.confidence;
    if (!skipValidation && rule.validate && !rule.validate(match[0])) {
      if (rule.onValidationFailure === "reject") return [];
      confidence = rule.unvalidatedConfidence;
    }
    const span = input.identity
      ? { start: match.index, end: match.index + match[0].length }
      : resolveSourceSpan(input, match.index, match[0].length);
    return span ? [{
      type: rule.type,
      subtype: rule.subtype,
      maskedAs: rule.maskedAs,
      start: span.start,
      end: span.end,
      confidence
    }] : [];
  });
}

function resolveSourceSpan(input: NormalizedInput, index: number, length: number): { start: number; end: number } | undefined {
  const first = input.sourceSpans[index];
  const last = input.sourceSpans[index + length - 1];
  return first && last ? { start: first.start, end: last.end } : undefined;
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

function validBankAccount(value: string): boolean {
  const number = digits(value);
  if (/^(\d)\1+$/.test(number)) return false;
  const issuer = bankAccounts.banks.find(({ prefix }) => number.startsWith(prefix));
  if (issuer) return issuer.digits.includes(number.length);
  return number.length >= bankAccounts.minDigits && number.length <= bankAccounts.maxDigits;
}

function validBizNo(value: string): boolean {
  const number = digits(value);
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  const sum = weights.reduce((total, weight, index) => total + Number(number[index]) * weight, 0)
    + Math.floor((Number(number[8]) * 5) / 10);
  return (10 - (sum % 10)) % 10 === Number(number[9]);
}
