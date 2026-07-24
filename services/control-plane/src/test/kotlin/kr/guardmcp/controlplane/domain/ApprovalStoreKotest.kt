package kr.guardmcp.controlplane.domain

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset

class ApprovalStoreKotest : StringSpec({
    val now = Instant.parse("2026-01-02T00:00:00Z")
    fun storeAt(instant: Instant) = ApprovalStore(Clock.fixed(instant, ZoneOffset.UTC))

    "created approvals expire 120 seconds after request" {
        val store = storeAt(now)
        val approval = store.create(
            sessionId = DemoSeed.SESSION_PII_ID,
            toolName = "send_email",
            arguments = mapOf("to" to "partner@external.example"),
            riskReason = "External email delivery requires human approval",
            policyId = "approve_external_email",
            ttl = Duration.ofSeconds(120),
        )

        approval.status shouldBe ApprovalStatus.PENDING
        approval.expiresAt shouldBe now.plusSeconds(120)
    }

    "each decision maps to its terminal status" {
        listOf(
            ApprovalDecision.APPROVE to ApprovalStatus.APPROVED,
            ApprovalDecision.APPROVE_MASKED to ApprovalStatus.APPROVED_MASKED,
            ApprovalDecision.BLOCK to ApprovalStatus.BLOCKED,
        ).forEach { (decision, expected) ->
            val store = storeAt(now)
            val decided = store.decide(DemoSeed.APPROVAL_PENDING_ID, decision, "reviewer")

            decided.status shouldBe expected
            decided.decision shouldBe decision
            decided.decidedBy shouldBe "reviewer"
            decided.decidedAt shouldBe now
        }
    }

    "second decision on the same approval conflicts" {
        val store = storeAt(now)
        store.decide(DemoSeed.APPROVAL_PENDING_ID, ApprovalDecision.APPROVE, "reviewer")

        val exception = shouldThrow<ApprovalAlreadyDecidedException> {
            store.decide(DemoSeed.APPROVAL_PENDING_ID, ApprovalDecision.BLOCK, "reviewer")
        }
        exception.approval.status shouldBe ApprovalStatus.APPROVED
    }

    "deciding an unknown approval fails with not found" {
        shouldThrow<ApprovalNotFoundException> {
            storeAt(now).decide(java.util.UUID.randomUUID(), ApprovalDecision.APPROVE, "reviewer")
        }
    }
})
