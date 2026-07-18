export type DetectionKind = "PII" | "SECRET" | "INJECTION";

export interface Detection {
  type: DetectionKind;
  subtype: string;
  value: string;
  maskedAs: string;
  start: number;
  end: number;
}

interface Rule {
  type: DetectionKind;
  subtype: string;
  pattern: RegExp;
  maskedAs: string;
  validate?: (value: string, input: string) => boolean;
}

const piiRules: Rule[] = [
  { type: "PII", subtype: "PHONE", pattern: /(?<!\d)01[016789][- ]?\d{3,4}[- ]?\d{4}(?!\d)/g, maskedAs: "[PHONE]" },
  { type: "PII", subtype: "RRN_LIKE", pattern: /(?<!\d)\d{6}[- ]?[1-8]\d{6}(?!\d)/g, maskedAs: "[RRN_LIKE]", validate: validRrnLike },
  { type: "PII", subtype: "BIZ_NO", pattern: /(?<!\d)\d{3}[- ]?\d{2}[- ]?\d{5}(?!\d)/g, maskedAs: "[BIZ_NO]", validate: validBizNo },
  { type: "PII", subtype: "CARD", pattern: /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g, maskedAs: "[CARD]", validate: validLuhn },
  { type: "PII", subtype: "EMAIL", pattern: /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, maskedAs: "[EMAIL]" },
  { type: "PII", subtype: "PASSPORT", pattern: /(?<![A-Z0-9])[MS][0-9]{8}(?![A-Z0-9])/gi, maskedAs: "[PASSPORT]" },
  { type: "PII", subtype: "DL_NO", pattern: /(?<!\d)(?:11|12|13|14|15|16|17|18|19|20|21|22|23|24|25|26|28)[- ]?\d{2}[- ]?\d{6}[- ]?\d{2}(?!\d)/g, maskedAs: "[DL_NO]" },
  { type: "PII", subtype: "ADDRESS", pattern: /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(?:특별시|광역시|특별자치시|특별자치도|도)?\s+[가-힣]+(?:시|군|구)\s+[가-힣0-9-]+(?:로|길|동)\s*\d*/g, maskedAs: "[ADDRESS]" },
  { type: "PII", subtype: "BANK_ACCOUNT", pattern: /(?:계좌|통장|입금)\s*(?:번호)?\s*[:：]?\s*(\d{2,6}(?:-\d{2,6}){2,4})/g, maskedAs: "[BANK_ACCOUNT]" }
];

const secretRules: Rule[] = [
  { type: "SECRET", subtype: "LLM_API_KEY", pattern: /\b(?:sk-ant-|sk-)[A-Za-z0-9_-]{16,}\b/g, maskedAs: "[SECRET]" },
  { type: "SECRET", subtype: "GITHUB_TOKEN", pattern: /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}\b/g, maskedAs: "[SECRET]" },
  { type: "SECRET", subtype: "AWS_ACCESS_KEY", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, maskedAs: "[SECRET]" },
  { type: "SECRET", subtype: "JWT", pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, maskedAs: "[SECRET]" },
  { type: "SECRET", subtype: "PRIVATE_KEY", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, maskedAs: "[SECRET]" },
  { type: "SECRET", subtype: "KOREAN_SERVICE_TOKEN", pattern: /\b(?:kakao|naver|toss)[_-]?(?:api[_-]?)?(?:key|token)[=:][A-Za-z0-9_-]{16,}\b/gi, maskedAs: "[SECRET]" }
];

const injectionRules: Rule[] = [
  { type: "INJECTION", subtype: "IGNORE_INSTRUCTIONS", pattern: /(?:ignore|disregard)\s+(?:all\s+)?(?:previous|prior)\s+instructions?/gi, maskedAs: "[INJECTION]" },
  { type: "INJECTION", subtype: "KO_IGNORE_INSTRUCTIONS", pattern: /(?:이전|앞선)\s*(?:의\s*)?(?:지시|명령)(?:를|은|는)?\s*(?:모두\s*)?(?:무시|잊어)/g, maskedAs: "[INJECTION]" },
  { type: "INJECTION", subtype: "ROLE_OVERRIDE", pattern: /(?:지금부터\s*너는|you\s+are\s+now)\s*(?:관리자|admin|developer)/gi, maskedAs: "[INJECTION]" },
  { type: "INJECTION", subtype: "EXFILTRATION", pattern: /(?:\.env|id_rsa|credentials).{0,80}(?:send|전송|메일)/gi, maskedAs: "[INJECTION]" }
];

export function detect(input: string): Detection[] {
  const normalized = input.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "");
  return [...piiRules, ...secretRules, ...injectionRules].flatMap((rule) => findRule(rule, normalized));
}

export function mask(input: string, detections = detect(input)): string {
  return [...detections]
    .sort((left, right) => right.start - left.start)
    .reduce((result, detection) => `${result.slice(0, detection.start)}${detection.maskedAs}${result.slice(detection.end)}`, input);
}

function findRule(rule: Rule, input: string): Detection[] {
  const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
  return [...input.matchAll(pattern)]
    .filter((match) => match.index !== undefined && (!rule.validate || rule.validate(match[0], input)))
    .map((match) => ({
      type: rule.type,
      subtype: rule.subtype,
      value: match[0],
      maskedAs: rule.maskedAs,
      start: match.index,
      end: match.index + match[0].length
    }));
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
