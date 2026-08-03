// SCR-401 Detector fixtures (spec §5.4). The control plane serves `/detect/preview` for real,
// but only covers phone, e-mail and sensitive paths, and reports neither a detector label nor a
// confidence. These fixtures cover what the design draws — including RRN and secrets — so the
// screen can be demonstrated without a gateway.

import type { DetectDirection, DetectionFinding, DetectionPreview, GuardAction } from "@/lib/api/types";

interface Rule {
  /** Detector label the design tags a finding with. */
  type: string;
  policyId: string;
  action: GuardAction;
  severity: DetectionFinding["severity"];
  confidence: number;
  pattern: RegExp;
  /** Replaces the match in the masked output; defaults to the type label. */
  label?: string;
  /** Keeps the finding list from echoing the very thing it just flagged. */
  redact?: (match: string) => string;
}

const RULES: Rule[] = [
  {
    type: "RRN",
    policyId: "mask_korean_rrn",
    action: "block",
    severity: "critical",
    confidence: 98,
    // The seventh digit encodes birth era and nationality: 1-4 are Korean nationals, 5-8 are
    // foreign residents, so narrowing it to 1-4 would quietly miss half the numbers.
    pattern: /\d{6}-?[1-8]\d{6}/g,
    // The design shows the resident number already partly hidden in the list — a detector that
    // echoed it in full would leak the value it exists to protect.
    redact: (match) => `${match.slice(0, 6)}-*******`
  },
  {
    type: "PHONE",
    policyId: "mask_korean_phone",
    action: "mask_then_allow",
    severity: "medium",
    confidence: 98,
    pattern: /01[016789]-?\d{3,4}-?\d{4}/g
  },
  {
    type: "SECRET",
    policyId: "mask_secret_token",
    action: "block",
    severity: "high",
    confidence: 92,
    pattern: /\b(?:sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{12,})\b/g,
    label: "SECRET_OPENAI"
  },
  {
    type: "PATH",
    policyId: "block_env_file_read",
    action: "block",
    severity: "high",
    confidence: 95,
    pattern: /(?:[\w./~-]*\/)?(?:\.env(?:\.\w+)?|id_rsa|credentials(?:\.json)?)/g
  },
  {
    type: "EMAIL",
    policyId: "approve_external_email",
    action: "require_approval",
    severity: "medium",
    confidence: 90,
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
  }
];

/** Fail-closed: the strongest action any finding carries becomes the verdict. */
const STRENGTH: GuardAction[] = ["block", "require_approval", "mask_then_allow", "allow"];

export function previewOf(text: string, direction: DetectDirection): DetectionPreview {
  const findings: DetectionFinding[] = [];

  for (const rule of RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      const start = match.index ?? 0;
      const raw = match[0];
      // A response is what the agent is about to hand back, so leaking there is the worse
      // direction — the tooltip's "방향별 기본 정책 강도가 다릅니다".
      const action = direction === "response" && rule.action === "mask_then_allow" ? "block" : rule.action;
      findings.push({
        policyId: rule.policyId,
        action,
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
    const rule = RULES.find((entry) => entry.policyId === finding.policyId);
    maskedText += text.slice(cursor, finding.start) + `[${rule?.label ?? finding.type}]`;
    cursor = finding.end;
  }
  maskedText += text.slice(cursor);

  return { verdict, findings: ordered, maskedText };
}
