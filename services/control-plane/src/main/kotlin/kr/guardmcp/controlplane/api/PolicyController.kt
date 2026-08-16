package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.GuardAction
import kr.guardmcp.controlplane.domain.GuardEventRepository
import kr.guardmcp.controlplane.domain.Policy
import kr.guardmcp.controlplane.domain.PolicyPack
import kr.guardmcp.controlplane.domain.PolicyStore
import kr.guardmcp.controlplane.domain.Severity
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.time.Clock
import java.time.Instant

data class PolicyPackUpdateRequest(val enabled: Boolean)

data class PolicyUpdateRequest(
    val action: String? = null,
    val severity: String? = null,
    val priority: Int? = null,
)

/**
 * `apps/console/lib/api/types.ts`'s `PolicyStats`. `firedLast30d` names the field the console
 * reads regardless of the requested `window` (SCR-302's table column is always the 30-day
 * count); `window`/`lastTriggeredAt` are additive (GMCP-80 §3.5), not read by the console yet.
 * `dryRun` is never populated: no policy in this system is ever marked dry-run (`PolicyRow
 * .dryRun`'s own comment — GMCP-77, unbuilt), so there is nothing honest to report for it.
 */
data class PolicyStatsResponse(
    val policyId: String,
    val window: String,
    val firedLast30d: Int,
    val lastTriggeredAt: Instant?,
)

@RestController
@RequestMapping("/api/v1")
class PolicyController(
    private val policyStore: PolicyStore,
    private val guardEventRepository: GuardEventRepository,
    private val clock: Clock,
) {
    @GetMapping("/policy-packs")
    fun policyPacks(): List<PolicyPack> = policyStore.listPacks()

    @GetMapping("/policies")
    fun policies(): List<Policy> = policyStore.listPolicies()

    @PutMapping("/policy-packs/{packId}")
    fun updatePack(@PathVariable packId: String, @RequestBody request: PolicyPackUpdateRequest): PolicyPack =
        policyStore.updatePack(packId, request.enabled)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "policy_pack_not_found", "policy pack $packId not found")

    @PutMapping("/policies/{policyId}")
    fun updatePolicy(@PathVariable policyId: String, @RequestBody request: PolicyUpdateRequest): Policy {
        val action = request.action?.let {
            GuardAction.fromWire(it)
                ?: throw ApiException(HttpStatus.BAD_REQUEST, "invalid_policy_action", "unknown action '$it'")
        }
        val severity = request.severity?.let {
            Severity.fromWire(it)
                ?: throw ApiException(HttpStatus.BAD_REQUEST, "invalid_policy_severity", "unknown severity '$it'")
        }
        if (request.priority != null && request.priority <= 0) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_policy_priority", "priority must be positive")
        }
        return policyStore.updatePolicy(policyId, action, severity, request.priority)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "policy_not_found", "policy $policyId not found")
    }

    /**
     * `dryRun=true` (GMCP-80 §3.5) always answers `firedLast30d=0`: nothing in this system ever
     * marks a policy as dry-run yet (see [PolicyStatsResponse]'s doc), so there is no dry-run
     * subset of `guard_event` to count. A policy with no trigger history answers 0, not 404 —
     * only an unknown `policyId` is a 404.
     */
    @GetMapping("/policies/{policyId}/stats")
    fun policyStats(
        @PathVariable policyId: String,
        @RequestParam(required = false, defaultValue = "30d") window: String,
        @RequestParam(required = false, defaultValue = "false") dryRun: Boolean,
    ): PolicyStatsResponse {
        policyStore.policy(policyId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "policy_not_found", "policy $policyId not found")
        val windowDays = WINDOW_PATTERN.matchEntire(window)?.groupValues?.get(1)?.toInt()
            ?: throw ApiException(HttpStatus.BAD_REQUEST, "invalid_window", "window must look like '30d'")
        if (dryRun) return PolicyStatsResponse(policyId, window, firedLast30d = 0, lastTriggeredAt = null)

        val since = clock.instant().minus(windowDays.toLong(), java.time.temporal.ChronoUnit.DAYS)
        val stats = guardEventRepository.policyStats(policyId, since)
        return PolicyStatsResponse(policyId, window, stats.triggeredCount, stats.lastTriggeredAt)
    }

    private companion object {
        val WINDOW_PATTERN = Regex("""(\d+)d""")
    }
}
