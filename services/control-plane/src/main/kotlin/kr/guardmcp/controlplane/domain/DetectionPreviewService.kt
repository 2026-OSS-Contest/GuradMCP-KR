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
 * Deterministic preview of how the seeded policy pack judges a text. This mirrors the
 * three seeded policies only; the full detector engine lives in packages/policy-engine.
 * Verdict aggregation is fail-closed: the strongest matched action wins.
 */
@Component
class DetectionPreviewService(private val policyStore: PolicyStore) {
    private val sensitivePathRegex = Regex("""(?:^|[\s"'`=:])((?:[\w./~-]*/)?(?:\.env(?:\.\w+)?|id_rsa|credentials(?:\.json)?))""")
    private val koreanPhoneRegex = Regex("""01[016789]-?\d{3,4}-?\d{4}""")
    private val emailRegex = Regex("""[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}""")

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

    fun preview(text: String): DetectionPreview {
        val findings = mutableListOf<DetectionFinding>()
        collect(findings, "block_env_file_read", sensitivePathRegex.findAll(text)) { match ->
            val group = requireNotNull(match.groups[1])
            group.value to group.range.first
        }
        collect(findings, "mask_korean_phone", koreanPhoneRegex.findAll(text)) { it.value to it.range.first }
        collect(findings, "approve_external_email", emailRegex.findAll(text)) { it.value to it.range.first }

        val verdict = failClosedOrder.firstOrNull { action -> findings.any { it.action == action } } ?: GuardAction.ALLOW
        return DetectionPreview(verdict = verdict, findings = findings.sortedBy(DetectionFinding::start), maskedText = mask(text))
    }

    private fun collect(
        findings: MutableList<DetectionFinding>,
        policyId: String,
        matches: Sequence<MatchResult>,
        extract: (MatchResult) -> Pair<String, Int>,
    ) {
        val policy = policyStore.policy(policyId) ?: return
        if (policyStore.enabledPackIds().none { it == policy.packId }) return
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
