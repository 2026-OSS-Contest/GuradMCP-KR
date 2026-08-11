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

    /**
     * `AuditChain` has no loader/setter — by design, the only public way to add an entry is
     * `recordTrustChange`, which always hashes correctly. Simulating a tampered stored record
     * (e.g. a row edited directly in the database) needs reflection to reach past that.
     */
    @Suppress("UNCHECKED_CAST")
    fun tamperEntry(chain: AuditChain, index: Int, mutate: (TrustLevelChangeEvent) -> TrustLevelChangeEvent) {
        val field = AuditChain::class.java.getDeclaredField("trustChanges")
        field.isAccessible = true
        val entries = field.get(chain) as MutableList<TrustLevelChangeEvent>
        entries[index] = mutate(entries[index])
    }

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

        tamperEntry(chain, 1) { it.copy(prevHash = "tampered") }

        chain.verify() shouldBe false
    }

    "a tampered payload fails verification even when prevHash/hash are left untouched" {
        val chain = chainAt(now)
        chain.recordTrustChange("server-1", TrustLevel.TRUSTED, TrustLevel.LIMITED, "downgrade", null)

        // Only the payload changes; hash/prevHash still match each other structurally, so a
        // verifier that just walks the prevHash→hash chain (rather than re-deriving each hash
        // from its payload) would miss this.
        tamperEntry(chain, 0) { it.copy(toTrust = TrustLevel.TRUSTED) }

        chain.verify() shouldBe false
    }
})
