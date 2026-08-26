package kr.guardmcp.controlplane.domain

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class ServerRegistryStoreKotest : StringSpec({
    val now = Instant.parse("2026-01-02T00:00:00Z")
    fun storeAt(instant: Instant) = ServerRegistryStore(
        Clock.fixed(instant, ZoneOffset.UTC),
        PolicyStore(Clock.fixed(instant, ZoneOffset.UTC)).also(PolicyFixtures::syncInto),
    )

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
        // PolicyFixtures (mirrors policy-packs/default + korean-pii): 2 BLOCK
        // (block_env_file_read, block_untrusted_injection_response) + 4 REQUIRE_APPROVAL
        // (approve_external_email_with_secret, require_approval_untrusted_high_risk_tool,
        // approve_external_email_with_korean_pii, require_approval_bulk_pii_response). The
        // fixture's block_large_address_dump is BLOCK too but dryRun: true, so it must not
        // inflate this count (GMCP-77) — see the next test for that exclusion made explicit.
        exception.affectedPolicyCount shouldBe 6
        store.get(DemoSeed.SERVER_DB_ID)?.trustLevel shouldBe TrustLevel.UNTRUSTED
    }

    "a dry-run policy never inflates the upgrade-confirmation impact estimate (GMCP-77)" {
        val store = storeAt(now)
        checkNotNull(PolicyFixtures.policies.find { it.id == "block_large_address_dump" }).dryRun shouldBe true

        val exception = shouldThrow<TrustUpgradeRequiresConfirmationException> {
            store.changeTrust(DemoSeed.SERVER_DB_ID, TrustLevel.LIMITED, confirmed = false)
        }
        // Same count as the previous test: block_large_address_dump is a BLOCK policy too, but
        // dryRun: true, so it must not appear as "impact" in a prompt asking an operator to
        // confirm a trust upgrade.
        exception.affectedPolicyCount shouldBe 6

        // Prove the exclusion is actually doing something: flip that one policy's dryRun off
        // and the count grows by exactly one.
        val withoutDryRun = PolicyFixtures.policies.map { if (it.id == "block_large_address_dump") it.copy(dryRun = false) else it }
        val storeWithoutDryRun = ServerRegistryStore(
            Clock.fixed(now, ZoneOffset.UTC),
            PolicyStore(Clock.fixed(now, ZoneOffset.UTC)).also { it.sync(PolicyFixtures.packs, withoutDryRun) },
        )
        val exceptionWithoutDryRun = shouldThrow<TrustUpgradeRequiresConfirmationException> {
            storeWithoutDryRun.changeTrust(DemoSeed.SERVER_DB_ID, TrustLevel.LIMITED, confirmed = false)
        }
        exceptionWithoutDryRun.affectedPolicyCount shouldBe 7
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
})
