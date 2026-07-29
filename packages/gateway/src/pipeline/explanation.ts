// Explanation Generator (GMCP-53) — turns a verdict into a sentence a person can read.
//
// The explainability KPI asks that every block state which policy decided it and why.
// A policy's own `message` is optional author prose and may be absent, so the reason a
// reader actually needs — verdict, deciding policy, severity, evidence — is composed
// here instead, and every guard event carries it.
//
// Proposal 10.6 UX writing rules this follows:
//   1. State the verdict as fact: "차단했습니다 — 정책 block_env_file_read (심각도 critical)".
//   2. No exclamation marks, no fear appeals, no adjectives that inflate the finding.
//   3. Technical identifiers (policy IDs, detector tags) are never translated.
// NFR-04: evidence is counts and tags only — never the matched text.
import type { Action, Explanation, PolicyDecision, Severity } from "./types.js";

export type { Explanation };

const verdictWords: Record<Action, { ko: string; en: string }> = {
  block: { ko: "차단했습니다", en: "Blocked" },
  require_approval: { ko: "승인을 기다립니다", en: "Waiting for approval" },
  mask_then_allow: { ko: "마스킹 후 전달했습니다", en: "Masked, then forwarded" },
  warn: { ko: "경고를 기록하고 통과시켰습니다", en: "Warned and forwarded" },
  allow: { ko: "통과시켰습니다", en: "Allowed" }
};

const severityWords: Record<Severity, { ko: string; en: string }> = {
  critical: { ko: "critical", en: "critical" },
  high: { ko: "high", en: "high" },
  medium: { ko: "medium", en: "medium" },
  low: { ko: "low", en: "low" },
  info: { ko: "info", en: "info" }
};

/**
 * Composes the reason sentence for one decision. `verdict` is passed separately from
 * `decision.verdict` because the router can land on a different one than the policy
 * proposed — an approval that times out is recorded as the block it became, and the
 * explanation has to describe what actually happened.
 */
export function explainDecision(decision: PolicyDecision, verdict: Action = decision.verdict): Explanation {
  const word = verdictWords[verdict];
  const decidingPolicy = decision.matchedPolicyIds[0];
  const cause = decidingPolicy
    ? {
      ko: `정책 ${decidingPolicy} (심각도 ${severityWords[decision.severity].ko})`,
      en: `policy ${decidingPolicy} (severity ${severityWords[decision.severity].en})`
    }
    : { ko: "매칭된 정책 없음, 정책팩 기본 동작", en: "no policy matched, pack default action" };
  const evidence = describeEvidence(decision);
  return {
    reasonCode: decision.reasonCode,
    ko: `${word.ko} — ${cause.ko}${evidence.ko}`,
    en: `${word.en} — ${cause.en}${evidence.en}`
  };
}

/**
 * Counts detections per type and states the risk score. Tags stay untranslated so a
 * reader can match them against the detector catalog; matched text is never included.
 */
function describeEvidence(decision: PolicyDecision): { ko: string; en: string } {
  const counts = new Map<string, number>();
  for (const { type } of decision.detections) counts.set(type, (counts.get(type) ?? 0) + 1);
  const parts = [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
  const score = { ko: `위험 점수 ${decision.riskScore}`, en: `risk score ${decision.riskScore}` };
  // With no detections the score opens its own English sentence, so it is capitalized;
  // after a detection list it continues the same clause and stays lowercase.
  if (parts.length === 0) return { ko: `. ${score.ko}.`, en: `. Risk score ${decision.riskScore}.` };
  return {
    ko: `. 탐지 ${parts.map(([type, count]) => `${type} ${count}건`).join(", ")}, ${score.ko}.`,
    en: `. Detected ${parts.map(([type, count]) => `${type} ×${count}`).join(", ")}, ${score.en}.`
  };
}
