package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.GuardAction
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
import org.springframework.web.bind.annotation.RestController

data class PolicyPackUpdateRequest(val enabled: Boolean)

data class PolicyUpdateRequest(
    val action: String? = null,
    val severity: String? = null,
    val priority: Int? = null,
)

@RestController
@RequestMapping("/api/v1")
class PolicyController(private val policyStore: PolicyStore) {
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
}
