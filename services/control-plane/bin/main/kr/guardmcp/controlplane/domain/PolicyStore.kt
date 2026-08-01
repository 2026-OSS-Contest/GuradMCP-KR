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
