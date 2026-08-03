// Explanation Generator (GMCP-53) — turns a verdict into a sentence a person can read.
//
// The explainability KPI asks that every block state which policy decided it and why.
// A policy's own `message` is optional author prose and may be absent, so the reason a
// reader actually needs — verdict, deciding policy, severity, evidence — is composed
// here instead, and every guard event the gateway emits carries it.
//
// Proposal 10.6 UX writing rules this follows:
//   1. State the verdict as fact: "차단했습니다 — 정책 block_env_file_read (심각도 critical)".
//   2. No exclamation marks, no fear appeals, no adjectives that inflate the finding.
//   3. Technical identifiers (policy IDs, detector tags) are never translated.
// NFR-04: evidence is counts and tags only — never the matched text.
import type { Action, Explanation, PolicyDecision, Severity } from "./types.js";

export type { Explanation };

/**
 * How an approval ended, when the verdict came out of the approval flow rather than
 * straight from the policy. A block because nobody answered in time is a different fact
 * from a block a policy asked for, and a reader has to be able to tell them apart —
 * this is exactly the case where the explanation matters most.
 */
export type ApprovalResolution = "expired" | "denied" | "approved" | "masked";

const verdictWords: Record<Action, { ko: string; en: string }> = {
  block: { ko: "차단했습니다", en: "Blocked" },
  require_approval: { ko: "승인을 기다립니다", en: "Waiting for approval" },
  mask_then_allow: { ko: "마스킹 후 전달했습니다", en: "Masked, then forwarded" },
  warn: { ko: "경고를 기록하고 통과시켰습니다", en: "Warned and forwarded" },
  allow: { ko: "통과시켰습니다", en: "Allowed" }
};

const resolutionWords: Record<ApprovalResolution, { ko: string; en: string }> = {
  expired: { ko: "승인 시간이 초과되어", en: "the approval timed out" },
  denied: { ko: "승인이 거부되어", en: "the approval was denied" },
  approved: { ko: "승인을 받아", en: "the request was approved" },
  masked: { ko: "마스킹 승인을 받아", en: "the request was approved with masking" }
};

/**
 * Severity is a technical identifier, so it reads identically in both locales (rule 3).
 * The map exists rather than a bare interpolation so that adding a severity to the DSL
 * fails to compile here until someone has considered how it should read.
 */
const severityLabel: Record<Severity, string> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
  info: "info"
};

/**
 * Composes the reason sentence for one decision.
 *
 * `verdict` is passed separately from `decision.verdict` because the router can land on
 * a different one than the policy proposed — an approval that times out is recorded as
 * the block it became, and the explanation has to describe what actually happened.
 */
export function explainDecision(
  decision: PolicyDecision,
  verdict: Action = decision.verdict,
  resolution?: ApprovalResolution
): Explanation {
  const word = verdictWords[verdict];
  const cause = describeCause(decision);
  const evidence = describeEvidence(decision);
  const reason = resolution ? resolutionWords[resolution] : undefined;
  return {
    reasonCode: decision.reasonCode,
    ko: `${word.ko}${reason ? ` (${reason.ko})` : ""} — ${cause.ko}${evidence.ko}`,
    en: `${word.en}${reason ? ` (${reason.en})` : ""} — ${cause.en}${evidence.en}`
  };
}

/**
 * Names the policy that actually decided.
 *
 * `matchedPolicyIds` holds every match in priority order, so under `severity-max` its
 * first element is usually the *weakest* one. Naming that would contradict `severity`,
 * `reasonCode`, and `message` on the same decision, which all come from the deciding
 * policy — so the sentence reads `decidingPolicyId` and mentions the rest as a count.
 */
function describeCause(decision: PolicyDecision): { ko: string; en: string } {
  const deciding = decision.decidingPolicyId;
  if (!deciding) return { ko: "매칭된 정책 없음, 정책팩 기본 동작", en: "no policy matched, pack default action" };
  const others = decision.matchedPolicyIds.filter((id) => id !== deciding).length;
  const alsoMatched = others > 0
    ? { ko: `, 외 ${others}건 매칭`, en: `, ${others} other${others === 1 ? "" : "s"} matched` }
    : { ko: "", en: "" };
  return {
    ko: `정책 ${deciding} (심각도 ${severityLabel[decision.severity]})${alsoMatched.ko}`,
    en: `policy ${deciding} (severity ${severityLabel[decision.severity]})${alsoMatched.en}`
  };
}

/**
 * Counts detections per tag and states the risk score. Tags keep their subtype — in a
 * Korean-PII product `PII.RRN_LIKE` and `PII.PHONE` call for different responses, so
 * collapsing both to `PII` would drop the part a reader acts on. Tags stay untranslated
 * so they can be matched against the detector catalog; matched text is never included.
 */
function describeEvidence(decision: PolicyDecision): { ko: string; en: string } {
  const counts = new Map<string, number>();
  for (const { type, subtype } of decision.detections) {
    const tag = subtype ? `${type}.${subtype}` : type;
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const parts = [...counts.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const score = { ko: `위험 점수 ${decision.riskScore}`, en: `risk score ${decision.riskScore}` };
  // With no detections the score opens its own English sentence, so it is capitalized;
  // after a detection list it continues the same clause and stays lowercase.
  if (parts.length === 0) return { ko: `. ${score.ko}.`, en: `. Risk score ${decision.riskScore}.` };
  return {
    ko: `. 탐지 ${parts.map(([tag, count]) => `${tag} ${count}건`).join(", ")}, ${score.ko}.`,
    en: `. Detected ${parts.map(([tag, count]) => `${tag} ×${count}`).join(", ")}, ${score.en}.`
  };
}
