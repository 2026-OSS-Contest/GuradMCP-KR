package kr.guardmcp.controlplane.domain

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class ServerRegistryStoreKotest : StringSpec({
    val now = Instant.parse("2026-01-02T00:00:00Z")
    fun storeAt(instant: Instant) = ServerRegistryStore(Clock.fixed(instant, ZoneOffset.UTC), PolicyStore(Clock.fixed(instant, ZoneOffset.UTC)))

    "seeds start every server at a manually assigned grade, unreviewed servers untrusted" {
        val store = storeAt(now)
        store.get(DemoSeed.SERVER_FILE_ID)?.trustLevel shouldBe TrustLevel.LIMITED
        store.get(DemoSeed.SERVER_MAIL_ID)?.trustLevel shouldBe TrustLevel.TRUSTED
        store.get(DemoSeed.SERVER_DB_ID)?.trustLevel shouldBe TrustLevel.UNTRUSTED
    }

    "a downgrade applies immediately regardless of confirmed" {
        val store = storeAt(now)
        val outcome = store.changeTrust(DemoSeed.SERVER_MAIL_ID, TrustLevel.LIMITED, confirmed = false)

        outcome.direction shouldBe "downgrade"
        outcome.server.trustLevel shouldBe TrustLevel.LIMITED
        outcome.server.trustLevelUpdatedAt shouldBe now
        outcome.server.trustLevelUpdatedBy shouldBe null
    }

    "an unconfirmed upgrade is rejected and leaves the grade untouched" {
        val store = storeAt(now)
        val exception = shouldThrow<TrustUpgradeRequiresConfirmationException> {
            store.changeTrust(DemoSeed.SERVER_DB_ID, TrustLevel.LIMITED, confirmed = false)
        }

        exception.server.trustLevel shouldBe TrustLevel.UNTRUSTED
        exception.toTrust shouldBe TrustLevel.LIMITED
        exception.affectedPolicyCount shouldBe 2 // seeded default pack: block_env_file_read (BLOCK) + approve_external_email (REQUIRE_APPROVAL)
        store.get(DemoSeed.SERVER_DB_ID)?.trustLevel shouldBe TrustLevel.UNTRUSTED
    }

    "a confirmed upgrade applies and records who confirmed it" {
        val store = storeAt(now)
        val outcome = store.changeTrust(DemoSeed.SERVER_DB_ID, TrustLevel.LIMITED, confirmed = true)

        outcome.direction shouldBe "upgrade"
        outcome.server.trustLevel shouldBe TrustLevel.LIMITED
        outcome.server.trustLevelUpdatedBy shouldBe "console"
    }

    "requesting the current grade again is a no-op" {
        val store = storeAt(now)
        val outcome = store.changeTrust(DemoSeed.SERVER_FILE_ID, TrustLevel.LIMITED, confirmed = false)

        outcome.direction shouldBe "none"
        outcome.server.trustLevelUpdatedAt shouldBe DemoSeed.SEEDED_AT
    }

    "an unknown server id fails with not found" {
        shouldThrow<ServerNotFoundException> {
            storeAt(now).changeTrust(java.util.UUID.randomUUID(), TrustLevel.TRUSTED, confirmed = true)
        }
    }

    "an unknown server's tool inventory is empty, not an error" {
        storeAt(now).toolsFor(java.util.UUID.randomUUID()) shouldBe emptyList()
    }

    "a tool whose description changed since approval carries its Rug Pull diff (FR-GW-03)" {
        val tools = storeAt(now).toolsFor(DemoSeed.SERVER_MAIL_ID)
        val sendEmail = tools.single { it.name == "send_email" }

        sendEmail.snapshotChanged shouldBe true
        sendEmail.snapshotDiff shouldNotBe null
    }

    "a tool unchanged since approval carries no diff" {
        val tools = storeAt(now).toolsFor(DemoSeed.SERVER_FILE_ID)
        val readFile = tools.single { it.name == "read_file" }

        readFile.snapshotChanged shouldBe false
        readFile.snapshotDiff shouldBe null
    }
})
