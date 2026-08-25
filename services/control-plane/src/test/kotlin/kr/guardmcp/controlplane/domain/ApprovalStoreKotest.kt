package kr.guardmcp.controlplane.domain

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset

/** Spies on [publish] so a test can assert an SSE event fired without a real HTTP layer. */
private class RecordingBroadcaster : EventBroadcaster() {
    val published = mutableListOf<Pair<String, Any>>()
    override fun publish(eventName: String, data: Any) {
        published += eventName to data
    }
}

class ApprovalStoreKotest : StringSpec({
    val now = Instant.parse("2026-01-02T00:00:00Z")
    fun storeAt(instant: Instant) = ApprovalStore(Clock.fixed(instant, ZoneOffset.UTC), EventBroadcaster())

    "created approvals expire 120 seconds after request" {
        val store = storeAt(now)
        val approval = store.create(
            sessionId = DemoSeed.SESSION_PII_ID.toString(),
            toolName = "send_email",
            arguments = mapOf("to" to "partner@external.example"),
            riskReason = "External email delivery requires human approval",
            policyId = "approve_external_email",
            ttl = Duration.ofSeconds(120),
        )

        approval.status shouldBe ApprovalStatus.PENDING
        approval.expiresAt shouldBe now.plusSeconds(120)
    }

    "a non-UUID gateway session id is accepted as-is" {
        val store = storeAt(now)
        val approval = store.create(
            sessionId = "req-1",
            toolName = "send_email",
            arguments = mapOf("to" to "outside@example.net"),
            riskReason = "External email delivery requires human approval",
            policyId = "approve_external_email_with_secret",
            ttl = Duration.ofSeconds(120),
        )

        approval.sessionId shouldBe "req-1"
    }

    "sweepExpired fails an unresolved approval closed once its deadline passes, and wipes its mask preview (NFR-04)" {
        val store = storeAt(now)
        val pending = store.create(
            sessionId = "req-1",
            toolName = "send_email",
            arguments = mapOf("to" to "outside@example.net"),
            riskReason = "External email delivery requires human approval",
            policyId = "approve_external_email_with_secret",
            ttl = Duration.ofSeconds(-1), // already past its deadline as of `now`
            maskPreview = mapOf("raw" to listOf(mapOf("sensitive" to "sk-ant-demo"))),
        )

        store.sweepExpired()
        val expired = store.get(pending.id)!!

        expired.status shouldBe ApprovalStatus.EXPIRED
        expired.decidedBy shouldBe "system:timeout"
        expired.maskPreview shouldBe null
    }

    // fix-api.md §5: sweepExpired() (the 1s scheduler tick) isn't the only path that can
    // discover a fail-closed expiry first — a GET /approvals poll can win the race just as
    // easily, and must still announce it rather than silently consuming the transition.
    "list() and get() also publish approval.resolved when they're the one that discovers the expiry" {
        val recorder = RecordingBroadcaster()
        val store = ApprovalStore(Clock.fixed(now, ZoneOffset.UTC), recorder)
        val pending = store.create(
            sessionId = "req-1", toolName = "send_email", arguments = emptyMap(),
            riskReason = "x", policyId = null, ttl = Duration.ofSeconds(-1),
        )
        recorder.published.clear() // drop the approval.created noise from create() above

        val viaList = store.list(null).first { it.id == pending.id }
        viaList.status shouldBe ApprovalStatus.EXPIRED
        recorder.published shouldContain ("approval.resolved" to viaList)

        // A second read must not re-publish: sweepExpiredLocked only returns what it *newly*
        // flips, and this approval is already EXPIRED by the time list() runs again.
        recorder.published.clear()
        store.get(pending.id)
        recorder.published shouldBe emptyList()
    }

    "decide() clears the mask preview once a human decision lands (NFR-04)" {
        val store = storeAt(now)
        val created = store.create(
            sessionId = "req-1", toolName = "send_email", arguments = emptyMap(),
            riskReason = "x", policyId = null, ttl = Duration.ofSeconds(120),
            maskPreview = mapOf("raw" to listOf(mapOf("sensitive" to "sk-ant-demo"))),
        )

        val decided = store.decide(created.id, ApprovalDecision.APPROVE_MASKED, "reviewer")

        decided.maskPreview shouldBe null
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
