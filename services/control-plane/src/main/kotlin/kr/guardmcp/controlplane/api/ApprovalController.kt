package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.Approval
import kr.guardmcp.controlplane.domain.ApprovalDecision
import kr.guardmcp.controlplane.domain.ApprovalStatus
import kr.guardmcp.controlplane.domain.ApprovalStore
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

/** Optional fields are nullable: the JSON mapper passes null for absent keys, normalized in the
 *  controller. `sessionId` is the gateway's own session id (§5.1 GMCP-26), not necessarily a
 *  UUID — e.g. `req-1` or a demo script's own ad hoc id — so unlike the demo-seeded sessions
 *  elsewhere in this service, it is never validated against a pre-registered session; a Tool
 *  Call held for approval is real evidence of a session on its own. `riskTags`/`threatScore`/
 *  `maskPreview` are the Approval Card's pre-decision evidence (§5.1 SCR-402), passed straight
 *  through to [ApprovalStore] uninterpreted. */
data class ApprovalCreateRequest(
    val sessionId: String,
    val toolName: String,
    val arguments: Map<String, String>?,
    val riskReason: String,
    val policyId: String?,
    val riskTags: List<Any?>? = null,
    val threatScore: Int? = null,
    val maskPreview: Any? = null,
)

data class ApprovalDecisionRequest(
    val decision: String,
    val decidedBy: String? = null,
)

@RestController
@RequestMapping("/api/v1")
class ApprovalController(
    private val approvalStore: ApprovalStore,
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
        if (request.sessionId.isBlank()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_session_id", "sessionId must not be blank")
        }
        if (request.toolName.isBlank()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_tool_name", "toolName must not be blank")
        }
        if (request.riskReason.isBlank()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_risk_reason", "riskReason must not be blank")
        }
        return approvalStore.create(
            sessionId = request.sessionId,
            toolName = request.toolName,
            arguments = request.arguments ?: emptyMap(),
            riskReason = request.riskReason,
            policyId = request.policyId,
            ttl = APPROVAL_TTL,
            riskTags = request.riskTags,
            threatScore = request.threatScore,
            maskPreview = request.maskPreview,
        )
    }

    @PostMapping("/approvals/{approvalId}/decision")
    fun decide(@PathVariable approvalId: UUID, @RequestBody request: ApprovalDecisionRequest): Approval {
        val decision = ApprovalDecision.fromWire(request.decision)
            ?: throw ApiException(
                HttpStatus.BAD_REQUEST,
                "invalid_approval_decision",
                "decision must be one of block, approve_masked, approve",
            )
        return approvalStore.decide(approvalId, decision, request.decidedBy ?: "console")
    }

    companion object {
        /** FR-APR-03: undecided approvals fail closed after 120 seconds. */
        val APPROVAL_TTL: Duration = Duration.ofSeconds(120)
    }
}
