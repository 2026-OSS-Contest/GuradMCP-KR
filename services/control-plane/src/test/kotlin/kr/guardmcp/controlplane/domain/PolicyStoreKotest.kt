package kr.guardmcp.controlplane.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class PolicyStoreKotest : StringSpec({
    val now = Instant.parse("2026-01-02T00:00:00Z")
    val store = { PolicyStore(Clock.fixed(now, ZoneOffset.UTC)) }

    "disabling a pack bumps its version and drops it from the active list" {
        val policyStore = store()
        val updated = policyStore.updatePack("korean-pii", enabled = false)

        checkNotNull(updated)
        updated.version shouldBe 2
        updated.updatedAt shouldBe now
        policyStore.enabledPackIds() shouldBe listOf("default")
    }

    "updating a policy bumps the owning pack version" {
        val policyStore = store()
        val updated = policyStore.updatePolicy("mask_korean_phone", action = GuardAction.BLOCK, severity = null, priority = null)

        checkNotNull(updated)
        updated.action shouldBe GuardAction.BLOCK
        policyStore.listPacks().single { it.id == "korean-pii" }.version shouldBe 2
    }

    "unknown identifiers return null" {
        store().updatePack("missing", enabled = true).shouldBeNull()
        store().updatePolicy("missing", null, null, null).shouldBeNull()
    }

    "policies list in priority order" {
        store().listPolicies().map(Policy::id) shouldBe
            listOf("block_env_file_read", "block_large_address_dump", "mask_korean_phone", "approve_external_email")
    }

    "dry-run policies are read-only and reported honestly (GMCP-77)" {
        val policy = store().policy("block_large_address_dump")
        checkNotNull(policy)
        policy.dryRun shouldBe true
        store().policy("block_env_file_read")?.dryRun shouldBe false
    }
})
