package kr.guardmcp.controlplane.domain

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ApprovalWorkflowServiceKotest : StringSpec({
    val now = Instant.parse("2026-01-02T00:00:00Z")

    fun serviceAt(instant: Instant): Pair<ApprovalWorkflowService, InMemoryApprovalQueue> {
        val clock = Clock.fixed(instant, ZoneOffset.UTC)
        val queue = InMemoryApprovalQueue()
        val service = ApprovalWorkflowService(ApprovalStore(clock), queue, EventStreamHub(clock), clock, Duration.ofSeconds(120))
        return service to queue
    }

    fun ApprovalWorkflowService.createSample(): Approval = create(
        sessionId = DemoSeed.SESSION_PII_ID,
        toolName = "send_email",
        arguments = mapOf("to" to "partner@external.example"),
        riskReason = "External email delivery requires human approval",
        policyId = "approve_external_email",
    )

    "registration enqueues the approval and resolution removes it" {
        val (service, queue) = serviceAt(now)
        val approval = service.createSample()

        queue.pendingIds() shouldContain approval.id
        service.decide(approval.id, ApprovalDecision.APPROVE, "reviewer")
        queue.pendingIds().shouldBeEmpty()
    }

    "overdue pending approvals fail closed as system-blocked expirations" {
        val (service, queue) = serviceAt(now)
        val approval = service.createSample()

        service.expireOverdueAt(now.plusSeconds(119)).shouldBeEmpty()
        val expired = service.expireOverdueAt(now.plusSeconds(120)).single()

        expired.id shouldBe approval.id
        expired.status shouldBe ApprovalStatus.EXPIRED
        expired.decision shouldBe ApprovalDecision.BLOCK
        expired.decidedBy shouldBe "system:timeout"
        expired.decidedAt shouldBe now.plusSeconds(120)
        queue.pendingIds().shouldBeEmpty()
        shouldThrow<ApprovalAlreadyDecidedException> {
            service.decide(approval.id, ApprovalDecision.APPROVE, "reviewer")
        }
    }

    "await releases the waiting caller when the decision arrives" {
        val (service, _) = serviceAt(now)
        val approval = service.createSample()
        val awaiting = CountDownLatch(1)
        val result = CompletableFuture<Approval>()

        Thread.ofVirtual().start {
            awaiting.countDown()
            result.complete(service.await(approval.id, Duration.ofSeconds(10)))
        }
        awaiting.await(5, TimeUnit.SECONDS) shouldBe true
        service.decide(approval.id, ApprovalDecision.APPROVE_MASKED, "reviewer")

        result.get(5, TimeUnit.SECONDS).status shouldBe ApprovalStatus.APPROVED_MASKED
    }

    "await on a still-pending approval returns the pending state after the wait window" {
        val (service, _) = serviceAt(now)
        val approval = service.createSample()

        service.await(approval.id, Duration.ofMillis(50)).status shouldBe ApprovalStatus.PENDING
    }

    "await on an already-resolved approval returns immediately" {
        val (service, _) = serviceAt(now)
        val approval = service.createSample()
        service.decide(approval.id, ApprovalDecision.BLOCK, "reviewer")

        service.await(approval.id, Duration.ofSeconds(10)).status shouldBe ApprovalStatus.BLOCKED
    }
})
