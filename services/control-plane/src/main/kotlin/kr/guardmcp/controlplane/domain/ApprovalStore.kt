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

/** Approval card: the tool call held for review plus the reason it was held.
 *
 * [riskTags]/[threatScore]/[maskPreview] are the pre-decision evidence a real Approval Card
 * needs (§5.1 SCR-402: risk tags, risk gauge, mask-diff preview) — passed through opaquely
 * (Jackson's generic `Any?` tree) rather than modeled field-by-field here, since this store has
 * no reason to interpret their shape, only to hold and later clear it. [maskPreview] carries raw
 * sensitive text and is legitimately in flight only while the approval is `PENDING` (NFR-04): it
 * is cleared the moment a decision lands, in [decide] and [sweepExpired] alike.
 */
data class Approval(
    val id: UUID,
    val sessionId: String,
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
    val riskTags: List<Any?>? = null,
    val threatScore: Int? = null,
    val maskPreview: Any? = null,
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
            sessionId = DemoSeed.SESSION_PII_ID.toString(),
            status = ApprovalStatus.PENDING,
            toolName = "send_email",
            arguments = mapOf("to" to "partner@external.example", "subject" to "고객 명단 공유"),
            riskReason = "External email delivery requires human approval",
            policyId = "approve_external_email_with_secret",
            requestedAt = DemoSeed.SEEDED_AT.plusSeconds(61),
            expiresAt = DemoSeed.APPROVAL_PENDING_EXPIRES_AT,
            decision = null,
            decidedBy = null,
            decidedAt = null,
        )
    }

    fun list(status: ApprovalStatus?): List<Approval> = synchronized(lock) {
        sweepExpiredLocked()
        approvals.values.filter { status == null || it.status == status }.sortedBy(Approval::requestedAt)
    }

    fun get(id: UUID): Approval? = synchronized(lock) {
        sweepExpiredLocked()
        approvals[id]
    }

    fun create(
        sessionId: String,
        toolName: String,
        arguments: Map<String, String>,
        riskReason: String,
        policyId: String?,
        ttl: Duration,
        riskTags: List<Any?>? = null,
        threatScore: Int? = null,
        maskPreview: Any? = null,
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
            riskTags = riskTags,
            threatScore = threatScore,
            maskPreview = maskPreview,
        )
        approvals[approval.id] = approval
        approval
    }

    fun decide(id: UUID, decision: ApprovalDecision, decidedBy: String): Approval = synchronized(lock) {
        sweepExpiredLocked()
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
            // NFR-04: raw preview text has no further legitimate use once a decision — human or
            // fail-closed — has landed.
            maskPreview = null,
        )
        approvals[id] = decided
        decided
    }

    fun countPending(): Int = synchronized(lock) {
        sweepExpiredLocked()
        approvals.values.count { it.status == ApprovalStatus.PENDING }
    }

    /** §5.1 Control Plane: 120s unresolved fails closed. Called by [ApprovalTimeoutScheduler]'s
     *  1s tick, and opportunistically by every read/decide above, so staleness is bounded by
     *  whichever comes first rather than only the scheduler's own cadence. */
    fun sweepExpired(): Unit = synchronized(lock) { sweepExpiredLocked() }

    private fun sweepExpiredLocked() {
        val now = clock.instant()
        for ((id, approval) in approvals) {
            if (approval.status != ApprovalStatus.PENDING) continue
            if (approval.expiresAt.isAfter(now)) continue
            approvals[id] = approval.copy(
                status = ApprovalStatus.EXPIRED,
                decidedBy = "system:timeout",
                decidedAt = now,
                maskPreview = null,
            )
        }
    }
}
