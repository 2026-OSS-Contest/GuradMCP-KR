package kr.guardmcp.controlplane.domain

import org.springframework.stereotype.Component
import java.time.Instant
import java.util.UUID

data class DemoSession(
    val id: UUID,
    val scenarioId: String,
    val title: String,
    val createdAt: Instant,
)

data class GuardEvent(
    val id: UUID,
    val sessionId: UUID,
    val sequenceNo: Int,
    val verdict: GuardAction,
    val toolName: String,
    val policyId: String?,
    val riskScore: Int,
    val occurredAt: Instant,
)

@Component
class GuardEventStore {
    private val lock = Any()
    private val sessions = linkedMapOf<UUID, DemoSession>()
    private val events = mutableListOf<GuardEvent>()

    init {
        listOf(
            DemoSession(DemoSeed.SESSION_INJECTION_ID, "T-01", "Prompt injection to credential read", DemoSeed.SEEDED_AT),
            DemoSession(DemoSeed.SESSION_PII_ID, "T-02", "Korean PII masking", DemoSeed.SEEDED_AT.plusSeconds(60)),
        ).forEach { sessions[it.id] = it }
        events += GuardEvent(
            id = DemoSeed.EVENT_BLOCKED_READ_ID,
            sessionId = DemoSeed.SESSION_INJECTION_ID,
            sequenceNo = 1,
            verdict = GuardAction.BLOCK,
            toolName = "read_file",
            policyId = "block_env_file_read",
            riskScore = 96,
            occurredAt = DemoSeed.SEEDED_AT.plusSeconds(1),
        )
        events += GuardEvent(
            id = DemoSeed.EVENT_MASKED_LOOKUP_ID,
            sessionId = DemoSeed.SESSION_PII_ID,
            sequenceNo = 1,
            verdict = GuardAction.MASK_THEN_ALLOW,
            toolName = "lookup_customer",
            policyId = "mask_korean_pii_response",
            riskScore = 82,
            occurredAt = DemoSeed.SEEDED_AT.plusSeconds(61),
        )
    }

    fun session(id: UUID): DemoSession? = synchronized(lock) { sessions[id] }

    fun countByVerdictSince(verdict: GuardAction, since: Instant): Int = synchronized(lock) {
        events.count { it.verdict == verdict && !it.occurredAt.isBefore(since) }
    }
}
