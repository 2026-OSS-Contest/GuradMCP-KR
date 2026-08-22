package kr.guardmcp.controlplane.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class PolicyStoreKotest : StringSpec({
    val now = Instant.parse("2026-01-02T00:00:00Z")
    val store = {
        PolicyStore(Clock.fixed(now, ZoneOffset.UTC)).also(PolicyFixtures::syncInto)
    }

    "before any sync, the store is honestly empty rather than fabricating a pack" {
        val policyStore = PolicyStore(Clock.fixed(now, ZoneOffset.UTC))

        policyStore.listPacks().shouldBe(emptyList())
        policyStore.listPolicies().shouldBe(emptyList())
    }

    "a sync populates packs and policies, and a second identical sync leaves versions unchanged" {
        val policyStore = PolicyStore(Clock.fixed(now, ZoneOffset.UTC))
        val first = policyStore.sync(PolicyFixtures.packs, PolicyFixtures.policies)

        first.packsStored shouldBe 2
        first.policiesStored shouldBe 9
        val versionAfterFirstSync = policyStore.listPacks().single { it.id == "default" }.version

        policyStore.sync(PolicyFixtures.packs, PolicyFixtures.policies)
        policyStore.listPacks().single { it.id == "default" }.version shouldBe versionAfterFirstSync
    }

    "a sync that changes a pack's enabled state bumps its version" {
        val policyStore = store()
        val disabledPacks = PolicyFixtures.packs.map { if (it.packId == "korean-pii") it.copy(enabled = false) else it }

        policyStore.sync(disabledPacks, PolicyFixtures.policies)

        policyStore.enabledPackIds() shouldBe listOf("default")
        policyStore.listPacks().single { it.id == "korean-pii" }.version shouldBe 2
    }

    "updating a policy bumps the owning pack version" {
        val policyStore = store()
        val updated = policyStore.updatePolicy("mask_korean_pii_response", action = GuardAction.BLOCK, severity = null, priority = null)

        checkNotNull(updated)
        updated.action shouldBe GuardAction.BLOCK
        policyStore.listPacks().single { it.id == "korean-pii" }.version shouldBe 2
    }

    "unknown identifiers return null" {
        store().updatePolicy("missing", null, null, null).shouldBeNull()
    }

    "policies list in priority order" {
        store().listPolicies().map(Policy::id).first() shouldBe "block_env_file_read"
        store().listPolicies().map(Policy::id).last() shouldBe "require_approval_bulk_pii_response"
    }

    "a synced policy carries its own enabled state and source path, not just its pack's" {
        val policyStore = store()
        val disabled = PolicyFixtures.policies.map { if (it.id == "warn_injection_request") it.copy(enabled = false) else it }
        policyStore.sync(PolicyFixtures.packs, disabled)

        val envRead = policyStore.policy("block_env_file_read")
        checkNotNull(envRead)
        envRead.enabled shouldBe true
        envRead.path shouldBe "policy-packs/default/policies/block-env-file-read.yaml"

        policyStore.policy("warn_injection_request")?.enabled shouldBe false
    }

    "a synced policy's source is retrievable, and an unknown one is not" {
        val policyStore = store()

        policyStore.source("block_env_file_read")?.path shouldBe "policy-packs/default/policies/block-env-file-read.yaml"
        policyStore.source("missing").shouldBeNull()
    }
})
