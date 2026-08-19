// SCR-401 Detector fixtures (spec §5.4). The control plane serves `/detect/preview` for real, but
// only covers phone, e-mail and sensitive paths, and reports neither a detector label nor a
// confidence. These fixtures cover what the design draws — RRN, bank accounts, secrets, injection
// wording — so the screen can be demonstrated without a gateway.
//
// Which policy acts on a finding depends on the direction, and the packs are lopsided about it on
// purpose (GMCP-117 fixed the mock, which had it backwards): the masking policies are
// response-side, because that is where external data enters the agent, while the file guard is
// request-side, because that is where the agent asks for something it should not have. The mock
// used to escalate every masking rule to `block` in the response direction, which is the opposite
// of what `mask_korean_pii_response` does, and it named four policies that exist in no pack.

import type { DetectDirection, DetectionFinding, DetectionPreview, GuardAction } from "@/lib/api/types";
import { subtypeOf } from "@/lib/detection-labels";

/** What a policy would do with this finding, in one direction. `null` — nothing acts on it. */
type Outcome = { action: GuardAction; policyId: string } | null;

interface Rule {
  /** Detector label the design tags a finding with. */
  type: string;
  severity: DetectionFinding["severity"];
  confidence: number;
  pattern: RegExp;
  /** Agent → Tool: the arguments a call is about to be made with. */
  request: Outcome;
  /** Tool → Agent: external data on its way in. */
  response: Outcome;
  /** Replaces the match in the masked output; defaults to the type label. */
  label?: string;
  /** Keeps the finding list from echoing the very thing it just flagged. */
  redact?: (match: string) => string;
}

/** Every Korean PII type lands on the same pair: nothing on the way out, masked on the way in. */
const PII_OUTCOMES = {
  request: null,
  response: { action: "mask_then_allow" as GuardAction, policyId: "mask_korean_pii_response" }
};

const RULES: Rule[] = [
  {
    type: "RRN_LIKE",
    severity: "critical",
    confidence: 98,
    // The seventh digit encodes birth era and nationality: 1-4 are Korean nationals, 5-8 are
    // foreign residents, so narrowing it to 1-4 would quietly miss half the numbers.
    pattern: /\d{6}-?[1-8]\d{6}/g,
    // The design shows the resident number already partly hidden in the list — a detector that
    // echoed it in full would leak the value it exists to protect.
    redact: (match) => `${match.slice(0, 6)}-*******`,
    ...PII_OUTCOMES
  },
  {
    type: "PHONE",
    severity: "medium",
    confidence: 98,
    pattern: /01[016789]-?\d{3,4}-?\d{4}/g,
    ...PII_OUTCOMES
  },
  {
    // The third type the consultation ticket carries, and the one the mock never had: SCR-301
    // shows a BANK_ACCOUNT chip in the same body this screen used to read straight past.
    type: "BANK_ACCOUNT",
    severity: "high",
    confidence: 94,
    pattern: /\b\d{3}-\d{2,3}-\d{5,6}\b/g,
    ...PII_OUTCOMES
  },
  {
    type: "SECRET",
    severity: "high",
    confidence: 92,
    pattern: /\b(?:sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{12,})\b/g,
    // Request-side, the one policy that acts on a credential is the external-mail guard; it also
    // needs the recipient to be outside the org, which a bare text preview cannot know. Shown as
    // the strongest thing that could happen to this text rather than as a promise about a call.
    request: { action: "require_approval", policyId: "approve_external_email_with_secret" },
    response: { action: "mask_then_allow", policyId: "mask_secret_response" }
  },
  {
    type: "PATH",
    severity: "high",
    confidence: 95,
    pattern: /(?:[\w./~-]*\/)?(?:\.env(?:\.\w+)?|id_rsa|id_ed25519|credentials(?:\.json)?)/g,
    request: { action: "block", policyId: "block_env_file_read" },
    // A credential file's *name* appearing in returned text is not itself a leak; the file guard
    // matches `direction: request`, on the arguments of the call that would open it.
    response: null
  },
  {
    // The README's hidden comment, and every variant under `sandbox/readme-variants/`.
    type: "INJECTION",
    severity: "critical",
    confidence: 96,
    pattern:
      /(?:이전|위의|상기|기존)\s*(?:지시|지시문|지시사항|규칙|프롬프트)[^\n]{0,12}?(?:무시|잊)|ignore (?:all )?previous instructions|disregard (?:all )?prior instructions/gi,
    request: { action: "warn", policyId: "warn_injection_request" },
    response: { action: "block", policyId: "block_untrusted_injection_response" }
  },
  {
    type: "EMAIL",
    severity: "medium",
    confidence: 90,
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    ...PII_OUTCOMES
  }
];

/** Fail-closed: the strongest action any finding carries becomes the verdict. */
const STRENGTH: GuardAction[] = ["block", "require_approval", "mask_then_allow", "warn", "allow"];

export function previewOf(text: string, direction: DetectDirection): DetectionPreview {
  const findings: DetectionFinding[] = [];

  for (const rule of RULES) {
    const outcome = direction === "request" ? rule.request : rule.response;
    for (const match of text.matchAll(rule.pattern)) {
      const start = match.index ?? 0;
      const raw = match[0];
      findings.push({
        // Detected either way; what differs is whether a policy acts on it, which is what the
        // screen's 방향별 기본 정책 강도가 다릅니다 tooltip is about.
        policyId: outcome?.policyId ?? "—",
        action: outcome?.action ?? "allow",
        severity: rule.severity,
        matchedText: rule.redact ? rule.redact(raw) : raw,
        start,
        end: start + raw.length,
        type: rule.type,
        confidence: rule.confidence
      });
    }
  }

  // Overlapping rules (a token inside a path, say) would double-count; the first match wins.
  const ordered = findings
    .sort((a, b) => a.start - b.start)
    .filter((finding, index, all) => index === 0 || finding.start >= all[index - 1].end);

  const verdict = STRENGTH.find((action) => ordered.some((finding) => finding.action === action)) ?? "allow";

  // The plain-text form the copy button hands over; the pane itself rebuilds this from the
  // offsets so it can draw each substitution as a chip.
  let maskedText = "";
  let cursor = 0;
  for (const finding of ordered) {
    const rule = RULES.find((entry) => entry.type === finding.type);
    // The design's stand-in for a secret names its issuer — `[SECRET_OPENAI]`. That is the
    // subtype, so it is derived from the token that matched rather than fixed per rule; an AWS
    // key used to come out labelled OpenAI.
    const subtype = subtypeOf(finding);
    const stand = rule?.label ?? (subtype ? `${finding.type}_${subtype}` : finding.type);
    maskedText += text.slice(cursor, finding.start) + `[${stand}]`;
    cursor = finding.end;
  }
  maskedText += text.slice(cursor);

  return { verdict, findings: ordered, maskedText };
}
