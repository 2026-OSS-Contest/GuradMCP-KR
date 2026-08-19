package kr.guardmcp.controlplane.domain

import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Instant

data class PolicyPack(
    val id: String,
    val version: Int,
    val enabled: Boolean,
    val description: String,
    val updatedAt: Instant,
)

data class Policy(
    val id: String,
    val packId: String,
    val priority: Int,
    val action: GuardAction,
    val severity: Severity,
    val description: String,
    /**
     * SPEC-POL-04 §3.1/§4.2 (GMCP-77): mirrors the DSL's `dry_run` on the policy-pack side —
     * evaluated but excluded from the real action. This demo store has no YAML behind it
     * (each seeded row is a deterministic stand-in for a real shipped policy — see the
     * `block_large_address_dump` entry below, which mirrors
     * `policy-packs/korean-pii/policies/dry-run-block-large-address-dump.yaml` verbatim), so
     * this field is read-only here too: [PolicyController.updatePolicy]'s request shape
     * intentionally has no way to flip it, matching §9's "정책은 파일 기반 편집" console policy.
     */
    val dryRun: Boolean = false,
)

@Component
class PolicyStore(private val clock: Clock) {
    private val lock = Any()
    private val packs = linkedMapOf<String, PolicyPack>()
    private val policies = linkedMapOf<String, Policy>()

    init {
        listOf(
            PolicyPack("default", 1, true, "Deterministic default protection policy pack", DemoSeed.SEEDED_AT),
            PolicyPack("korean-pii", 1, true, "Deterministic Korean PII masking policy pack", DemoSeed.SEEDED_AT),
        ).forEach { packs[it.id] = it }
        listOf(
            Policy("block_env_file_read", "default", 100, GuardAction.BLOCK, Severity.CRITICAL, "Block reads of credential files"),
            Policy(
                "block_large_address_dump", "korean-pii", 150, GuardAction.BLOCK, Severity.HIGH,
                "Block responses disclosing a Korean street address (verifying, not yet enforced)",
                dryRun = true,
            ),
            Policy("mask_korean_phone", "korean-pii", 200, GuardAction.MASK_THEN_ALLOW, Severity.HIGH, "Mask Korean mobile phone numbers"),
            Policy("approve_external_email", "default", 300, GuardAction.REQUIRE_APPROVAL, Severity.HIGH, "Require approval for external email"),
        ).forEach { policies[it.id] = it }
    }

    fun listPacks(): List<PolicyPack> = synchronized(lock) { packs.values.toList() }

    fun listPolicies(): List<Policy> = synchronized(lock) { policies.values.sortedBy(Policy::priority) }

    fun enabledPackIds(): List<String> = synchronized(lock) { packs.values.filter(PolicyPack::enabled).map(PolicyPack::id) }

    fun updatePack(id: String, enabled: Boolean): PolicyPack? = synchronized(lock) {
        val current = packs[id] ?: return null
        val updated = current.copy(enabled = enabled, version = current.version + 1, updatedAt = clock.instant())
        packs[id] = updated
        updated
    }

    fun updatePolicy(id: String, action: GuardAction?, severity: Severity?, priority: Int?): Policy? = synchronized(lock) {
        val current = policies[id] ?: return null
        val updated = current.copy(
            action = action ?: current.action,
            severity = severity ?: current.severity,
            priority = priority ?: current.priority,
        )
        policies[id] = updated
        val pack = packs.getValue(updated.packId)
        packs[updated.packId] = pack.copy(version = pack.version + 1, updatedAt = clock.instant())
        updated
    }

    fun policy(id: String): Policy? = synchronized(lock) { policies[id] }
}
