package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.Approval
import kr.guardmcp.controlplane.domain.ApprovalDecision
import kr.guardmcp.controlplane.domain.ApprovalStatus
import kr.guardmcp.controlplane.domain.ApprovalStore
import kr.guardmcp.controlplane.domain.EventStreamHub
import kr.guardmcp.controlplane.domain.GuardEventStore
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.time.Duration
import java.util.UUID

/** Optional fields are nullable: the JSON mapper passes null for absent keys, normalized in the controller. */
data class ApprovalCreateRequest(
    val sessionId: UUID,
    val toolName: String,
    val arguments: Map<String, String>?,
    val riskReason: String,
    val policyId: String?,
)

data class ApprovalDecisionRequest(
    val decision: String,
    val decidedBy: String? = null,
)

@RestController
@RequestMapping("/api/v1")
class ApprovalController(
    private val approvalStore: ApprovalStore,
    private val eventStore: GuardEventStore,
    private val eventStreamHub: EventStreamHub,
) {
    @GetMapping("/approvals")
    fun approvals(@RequestParam(required = false) status: String?): List<Approval> {
        val filter = status?.let {
            ApprovalStatus.fromWire(it)
                ?: throw ApiException(HttpStatus.BAD_REQUEST, "invalid_approval_status", "unknown status '$it'")
        }
        return approvalStore.list(filter)
    }

    @PostMapping("/approvals")
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@RequestBody request: ApprovalCreateRequest): Approval {
        if (eventStore.session(request.sessionId) == null) {
            throw ApiException(HttpStatus.NOT_FOUND, "session_not_found", "session ${request.sessionId} not found")
        }
        if (request.toolName.isBlank()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_tool_name", "toolName must not be blank")
        }
        if (request.riskReason.isBlank()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_risk_reason", "riskReason must not be blank")
        }
        val approval = approvalStore.create(
            sessionId = request.sessionId,
            toolName = request.toolName,
            arguments = request.arguments ?: emptyMap(),
            riskReason = request.riskReason,
            policyId = request.policyId,
            ttl = APPROVAL_TTL,
        )
        eventStreamHub.publishApprovalCreated(approval)
        return approval
    }

    @PostMapping("/approvals/{approvalId}/decision")
    fun decide(@PathVariable approvalId: UUID, @RequestBody request: ApprovalDecisionRequest): Approval {
        val decision = ApprovalDecision.fromWire(request.decision)
            ?: throw ApiException(
                HttpStatus.BAD_REQUEST,
                "invalid_approval_decision",
                "decision must be one of block, approve_masked, approve",
            )
        val decided = approvalStore.decide(approvalId, decision, request.decidedBy ?: "console")
        eventStreamHub.publishApprovalResolved(decided)
        return decided
    }

    companion object {
        /** FR-APR-03: undecided approvals fail closed after 120 seconds. */
        val APPROVAL_TTL: Duration = Duration.ofSeconds(120)
    }
}
