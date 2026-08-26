package kr.guardmcp.controlplane.domain

import org.springframework.stereotype.Component

data class DetectionFinding(
    val policyId: String,
    val action: GuardAction,
    val severity: Severity,
    val matchedText: String,
    val start: Int,
    val end: Int,
)

data class DetectionPreview(
    val verdict: GuardAction,
    val findings: List<DetectionFinding>,
    val maskedText: String,
)

/**
 * Deterministic preview of how the synced policy pack judges a text. This mirrors a handful of
 * the real policies with hand-rolled regexes — the full detector engine lives in
 * packages/policy-engine — and now reads those policies' real `direction`/`action`/`severity`
 * from [PolicyStore] (fix-api.md §1) rather than a hardcoded id/action mapping. A policy id this
 * service references but that [PolicyStore] hasn't synced yet (or whose pack is disabled)
 * simply never fires — see [collect].
 *
 * Verdict aggregation is fail-closed: the strongest matched action wins.
 */
@Component
class DetectionPreviewService(private val policyStore: PolicyStore) {
    private val sensitivePathRegex = Regex("""(?:^|[\s"'`=:])((?:[\w./~-]*/)?(?:\.env(?:\.\w+)?|id_rsa|credentials(?:\.json)?))""")
    private val koreanPhoneRegex = Regex("""01[016789]-?\d{3,4}-?\d{4}""")
    private val emailRegex = Regex("""[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}""")

    // Category-1 instruction-override phrasing, ported 1:1 (English + Korean) from the real
    // detector's IGNORE_INSTRUCTIONS rule (packages/gateway/src/rules/injection.json) — the
    // pattern FR-INJ-03's own example ("ignore previous instructions") is drawn from. Kept
    // narrow (this one rule, not the whole catalog) since this is a deterministic preview, not
    // the full engine.
    private val injectionPhraseRegex = Regex(
        """(?:ignore|disregard|forget|override)\s+(?:(?:all|any|every|the|previous|prior|above|earlier|your|모든|이전|앞선|위의?)\s+)+(?:instructions?|prompts?|rules?|guidelines?|directions?|지시(?:사항)?|명령|규칙|프롬프트|지침)""",
        RegexOption.IGNORE_CASE,
    )

    // Descending severity, mirroring the ACTION_RANK/actionWeight tables that the real decision
    // engine and gateway use to pick the strongest matching action (packages/policy-engine/src/decide.ts,
    // packages/policy-engine/src/index.ts, packages/gateway/src/server.ts): block=4 > require_approval=3
    // > warn=2 > mask_then_allow=1 > allow=0.
    private val failClosedOrder = listOf(
        GuardAction.BLOCK,
        GuardAction.REQUIRE_APPROVAL,
        GuardAction.WARN,
        GuardAction.MASK_THEN_ALLOW,
        GuardAction.ALLOW,
    )

    /**
     * fix-api.md §3: `direction` narrows which policies are eligible candidates — a policy whose
     * synced `direction` is set and disagrees with the requested one never fires. `null` (no
     * direction requested) keeps every previously-existing detector's behavior unchanged
     * (backward compatible) but skips the direction-dependent injection detector entirely,
     * since there is no honest single verdict to report for it without knowing which side of
     * the call the text is on (`warn_injection_request` vs `block_untrusted_injection_response`
     * disagree on both action and severity for the exact same wording).
     */
    fun preview(text: String, direction: String? = null): DetectionPreview {
        val findings = mutableListOf<DetectionFinding>()
        collect(findings, "block_env_file_read", direction, sensitivePathRegex.findAll(text)) { match ->
            val group = requireNotNull(match.groups[1])
            group.value to group.range.first
        }
        collect(findings, "mask_korean_pii_response", direction, koreanPhoneRegex.findAll(text)) { it.value to it.range.first }
        collect(findings, "approve_external_email_with_secret", direction, emailRegex.findAll(text)) { it.value to it.range.first }
        if (direction != null) {
            val injectionPolicyId = if (direction == "response") "block_untrusted_injection_response" else "warn_injection_request"
            collect(findings, injectionPolicyId, direction, injectionPhraseRegex.findAll(text)) { it.value to it.range.first }
        }

        val verdict = failClosedOrder.firstOrNull { action -> findings.any { it.action == action } } ?: GuardAction.ALLOW
        return DetectionPreview(verdict = verdict, findings = findings.sortedBy(DetectionFinding::start), maskedText = mask(text))
    }

    private fun collect(
        findings: MutableList<DetectionFinding>,
        policyId: String,
        requestedDirection: String?,
        matches: Sequence<MatchResult>,
        extract: (MatchResult) -> Pair<String, Int>,
    ) {
        val policy = policyStore.policy(policyId) ?: return
        if (policyStore.enabledPackIds().none { it == policy.packId }) return
        val policyDirection = policy.direction
        if (requestedDirection != null && policyDirection != null && policyDirection != "any" && policyDirection != requestedDirection) return
        matches.forEach { match ->
            val (matchedText, start) = extract(match)
            findings += DetectionFinding(
                policyId = policy.id,
                action = policy.action,
                severity = policy.severity,
                matchedText = matchedText,
                start = start,
                end = start + matchedText.length,
            )
        }
    }

    private fun mask(text: String): String = koreanPhoneRegex.replace(text) { match ->
        val digits = match.value.filter(Char::isDigit)
        val head = digits.take(3)
        val tail = digits.takeLast(4)
        "$head-****-$tail"
    }
}
