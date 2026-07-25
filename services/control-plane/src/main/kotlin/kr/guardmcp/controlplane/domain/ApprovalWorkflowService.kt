package kr.guardmcp.controlplane.domain

import org.springframework.beans.factory.annotation.Value
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * FR-APR-01/02/03: registration holds the tool call in the wait queue, a three-way
 * decision (or the 120-second fail-closed timeout) resolves it, and the waiting
 * gateway request is released through [await].
 */
@Component
class ApprovalWorkflowService(
    private val store: ApprovalStore,
    private val queue: ApprovalQueue,
    private val hub: EventStreamHub,
    private val clock: Clock,
    @param:Value("\${guardmcp.approval.timeout:PT120S}") private val timeout: Duration,
) {
    private val waiters = ConcurrentHashMap<UUID, CompletableFuture<Approval>>()

    fun list(status: ApprovalStatus?): List<Approval> = store.list(status)

    fun get(id: UUID): Approval? = store.get(id)

    fun pendingQueueIds(): List<UUID> = queue.pendingIds()

    fun create(
        sessionId: UUID,
        toolName: String,
        arguments: Map<String, String>,
        riskReason: String,
        policyId: String?,
    ): Approval {
        val approval = store.create(sessionId, toolName, arguments, riskReason, policyId, timeout)
        queue.enqueue(approval.id)
        hub.publishApprovalCreated(approval)
        return approval
    }

    fun decide(id: UUID, decision: ApprovalDecision, decidedBy: String): Approval {
        val decided = store.decide(id, decision, decidedBy)
        resolve(decided)
        return decided
    }

    /**
     * Blocks (on a virtual thread) until the approval is resolved or [waitFor] elapses;
     * a timed-out wait returns the current state so the gateway can keep polling.
     */
    fun await(id: UUID, waitFor: Duration): Approval {
        val current = store.get(id) ?: throw ApprovalNotFoundException(id)
        if (current.status != ApprovalStatus.PENDING) return current
        val future = waiters.computeIfAbsent(id) { CompletableFuture() }
        val recheck = checkNotNull(store.get(id))
        if (recheck.status != ApprovalStatus.PENDING) return recheck
        return try {
            future.get(waitFor.toMillis(), TimeUnit.MILLISECONDS)
        } catch (_: TimeoutException) {
            checkNotNull(store.get(id))
        }
    }

    /** Fail-closed sweep: every overdue pending approval is auto-blocked. */
    @Scheduled(fixedDelayString = "\${guardmcp.approval.sweep-interval:PT1S}")
    fun expireOverdue(): List<Approval> = expireOverdueAt(clock.instant())

    fun expireOverdueAt(now: Instant): List<Approval> = store.expireOverdue(now).onEach(::resolve)

    private fun resolve(approval: Approval) {
        queue.remove(approval.id)
        hub.publishApprovalResolved(approval)
        waiters.remove(approval.id)?.complete(approval)
    }
}
