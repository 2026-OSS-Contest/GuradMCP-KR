package kr.guardmcp.controlplane.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class AuditChainKotest : StringSpec({
    val now = Instant.parse("2026-01-02T00:00:00Z")
    fun chainAt(instant: Instant) = AuditChain(Clock.fixed(instant, ZoneOffset.UTC))

    "the first entry chains from genesis" {
        val chain = chainAt(now)
        val event = chain.recordTrustChange("server-1", TrustLevel.TRUSTED, TrustLevel.LIMITED, "downgrade", null)

        event.prevHash shouldBe AuditChain.GENESIS_HASH
        event.hash shouldNotBe AuditChain.GENESIS_HASH
        chain.verify() shouldBe true
    }

    "each entry links to the previous entry's hash" {
        val chain = chainAt(now)
        val first = chain.recordTrustChange("server-1", TrustLevel.TRUSTED, TrustLevel.LIMITED, "downgrade", null)
        val second = chain.recordTrustChange("server-1", TrustLevel.LIMITED, TrustLevel.TRUSTED, "upgrade", "console")

        second.prevHash shouldBe first.hash
        chain.trustChangeEvents().map { it.eventId } shouldBe listOf(first.eventId, second.eventId)
        chain.verify() shouldBe true
    }

    "a tampered prevHash fails verification" {
        val chain = chainAt(now)
        chain.recordTrustChange("server-1", TrustLevel.TRUSTED, TrustLevel.LIMITED, "downgrade", null)
        chain.recordTrustChange("server-1", TrustLevel.LIMITED, TrustLevel.TRUSTED, "upgrade", "console")

        val tampered = chain.trustChangeEvents().toMutableList()
        tampered[1] = tampered[1].copy(prevHash = "tampered")
        var previous = AuditChain.GENESIS_HASH
        val stillValid = tampered.all { event -> (event.prevHash == previous).also { previous = event.hash } }
        stillValid shouldBe false
    }
})
