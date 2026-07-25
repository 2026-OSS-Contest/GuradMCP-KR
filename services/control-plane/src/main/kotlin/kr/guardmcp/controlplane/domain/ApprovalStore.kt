package kr.guardmcp.controlplane.domain

import com.fasterxml.jackson.annotation.JsonValue
import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID

enum class ApprovalStatus(@get:JsonValue val wire: String) {
    PENDING("pending"),
    APPROVED("approved"),
    APPROVED_MASKED("approved_masked"),
    BLOCKED("blocked"),
    EXPIRED("expired");

    companion object {
        fun fromWire(value: String): ApprovalStatus? = entries.firstOrNull { it.wire == value }
    }
}

enum class ApprovalDecision(@get:JsonValue val wire: String) {
    BLOCK("block"),
    APPROVE_MASKED("approve_masked"),
    APPROVE("approve");

    companion object {
        fun fromWire(value: String): ApprovalDecision? = entries.firstOrNull { it.wire == value }
    }
}

/** Approval card: the tool call held for review plus the reason it was held. */
data class Approval(
    val id: UUID,
    val sessionId: UUID,
    val status: ApprovalStatus,
    val toolName: String,
    val arguments: Map<String, String>,
    val riskReason: String,
    val policyId: String?,
    val requestedAt: Instant,
    val expiresAt: Instant,
    val decision: ApprovalDecision?,
    val decidedBy: String?,
    val decidedAt: Instant?,
)

class ApprovalNotFoundException(val id: UUID) : RuntimeException("approval $id not found")

class ApprovalAlreadyDecidedException(val approval: Approval) :
    RuntimeException("approval ${approval.id} is already ${approval.status.wire}")

@Component
class ApprovalStore(private val clock: Clock) {
    private val lock = Any()
    private val approvals = linkedMapOf<UUID, Approval>()

    init {
        approvals[DemoSeed.APPROVAL_PENDING_ID] = Approval(
            id = DemoSeed.APPROVAL_PENDING_ID,
            sessionId = DemoSeed.SESSION_PII_ID,
            status = ApprovalStatus.PENDING,
            toolName = "send_email",
            arguments = mapOf("to" to "partner@external.example", "subject" to "고객 명단 공유"),
            riskReason = "External email delivery requires human approval",
            policyId = "approve_external_email",
            requestedAt = DemoSeed.SEEDED_AT.plusSeconds(61),
            expiresAt = DemoSeed.APPROVAL_PENDING_EXPIRES_AT,
            decision = null,
            decidedBy = null,
            decidedAt = null,
        )
    }

    fun list(status: ApprovalStatus?): List<Approval> = synchronized(lock) {
        approvals.values.filter { status == null || it.status == status }.sortedBy(Approval::requestedAt)
    }

    fun get(id: UUID): Approval? = synchronized(lock) { approvals[id] }

    fun create(
        sessionId: UUID,
        toolName: String,
        arguments: Map<String, String>,
        riskReason: String,
        policyId: String?,
        ttl: Duration,
    ): Approval = synchronized(lock) {
        val now = clock.instant()
        val approval = Approval(
            id = UUID.randomUUID(),
            sessionId = sessionId,
            status = ApprovalStatus.PENDING,
            toolName = toolName,
            arguments = arguments,
            riskReason = riskReason,
            policyId = policyId,
            requestedAt = now,
            expiresAt = now.plus(ttl),
            decision = null,
            decidedBy = null,
            decidedAt = null,
        )
        approvals[approval.id] = approval
        approval
    }

    fun decide(id: UUID, decision: ApprovalDecision, decidedBy: String): Approval = synchronized(lock) {
        val current = approvals[id] ?: throw ApprovalNotFoundException(id)
        if (current.status != ApprovalStatus.PENDING) throw ApprovalAlreadyDecidedException(current)
        val decided = current.copy(
            status = when (decision) {
                ApprovalDecision.APPROVE -> ApprovalStatus.APPROVED
                ApprovalDecision.APPROVE_MASKED -> ApprovalStatus.APPROVED_MASKED
                ApprovalDecision.BLOCK -> ApprovalStatus.BLOCKED
            },
            decision = decision,
            decidedBy = decidedBy,
            decidedAt = clock.instant(),
        )
        approvals[id] = decided
        decided
    }

    fun countPending(): Int = synchronized(lock) { approvals.values.count { it.status == ApprovalStatus.PENDING } }

    /** FR-APR-03 fail-closed: overdue pending approvals become expired with a system block decision. */
    fun expireOverdue(now: Instant): List<Approval> = synchronized(lock) {
        approvals.values
            .filter { it.status == ApprovalStatus.PENDING && !it.expiresAt.isAfter(now) }
            .map { current ->
                val expired = current.copy(
                    status = ApprovalStatus.EXPIRED,
                    decision = ApprovalDecision.BLOCK,
                    decidedBy = "system:timeout",
                    decidedAt = now,
                )
                approvals[current.id] = expired
                expired
            }
    }
}
