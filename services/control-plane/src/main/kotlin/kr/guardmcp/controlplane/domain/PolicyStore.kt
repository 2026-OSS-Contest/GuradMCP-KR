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
    /** `match.direction` from the policy's YAML: "request" | "response" | "any" | null when unknown (fix-api.md §3). */
    val direction: String? = null,
    /** The policy's own `enabled:` (defaults true) — distinct from its pack's [PolicyPack.enabled]; `PolicyRow.enabled` on the console. */
    val enabled: Boolean = true,
    /** Repo-relative source path, same value as [PolicySource.path] — `PolicyRow.path`'s caption (fix-api.md §4), without a second round-trip to `/source`. */
    val path: String? = null,
    /**
     * SPEC-POL-04 §3.1/§4.2 (GMCP-77): mirrors the DSL's `dry_run` on the policy-pack side —
     * evaluated but excluded from the real action. Pushed in by the Gateway's own sync
     * (`policy.dry_run`, `default_dry_run` already folded in — see `packRegistry.ts`'s
     * `loadPack`), same as every other field on this class; there is no local override —
     * [PolicyController.updatePolicy]'s request shape intentionally has no way to flip it,
     * matching §9's "정책은 파일 기반 편집" console policy.
     */
    val dryRun: Boolean = false,
)

/** The raw YAML a policy was parsed from, and where — served by `GET /policies/{id}/source` (fix-api.md §4). */
data class PolicySource(val policyId: String, val path: String, val yaml: String)

data class PolicySyncPackInput(val packId: String, val name: String, val description: String? = null, val enabled: Boolean = true)

data class PolicySyncPolicyInput(
    val id: String,
    val packId: String,
    val priority: Int,
    val action: String,
    val severity: String,
    val description: String? = null,
    val direction: String? = null,
    val enabled: Boolean = true,
    val sourcePath: String? = null,
    val sourceYaml: String? = null,
    val dryRun: Boolean = false,
)

data class PolicySyncResult(val packsStored: Int, val policiesStored: Int, val syncedAt: Instant)

/**
 * Gateway-fed registry of the policy packs/policies actually enforced (fix-api.md §1, option B).
 * The Gateway is the only process that parses `policy-packs/` (`packages/policy-engine`'s loader);
 * this store just mirrors whatever it last reported via `POST /policies/sync`, called once at
 * Gateway boot and again after every hot-reload. There is deliberately no hardcoded seed here
 * anymore — before the first sync arrives (Gateway not yet reachable, or `CONTROL_PLANE_URL`
 * unset in a dev/test deployment) this store is honestly empty rather than fabricating packs
 * that may not match what is actually enforced.
 *
 * `updatePolicy` remains a local, console-only override (action/severity/priority) for display
 * purposes; it is not pushed to the Gateway and is wiped by the next sync, same as before.
 * There is no `updatePack` anymore — see [PolicyController]'s `PUT /policy-packs/{id}`, which
 * now answers 409 rather than silently accepting a toggle the Gateway will never honor.
 */
@Component
class PolicyStore(private val clock: Clock) {
    private val lock = Any()
    private var packs = linkedMapOf<String, PolicyPack>()
    private var policies = linkedMapOf<String, Policy>()
    private var sources = linkedMapOf<String, PolicySource>()

    fun sync(packInputs: List<PolicySyncPackInput>, policyInputs: List<PolicySyncPolicyInput>): PolicySyncResult = synchronized(lock) {
        val now = clock.instant()
        val nextPacks = linkedMapOf<String, PolicyPack>()
        for (input in packInputs) {
            val previous = packs[input.packId]
            val changed = previous == null || previous.enabled != input.enabled || previous.description != (input.description ?: "")
            nextPacks[input.packId] = PolicyPack(
                id = input.packId,
                version = if (changed) (previous?.version ?: 0) + 1 else previous!!.version,
                enabled = input.enabled,
                description = input.description ?: "",
                updatedAt = if (changed) now else previous!!.updatedAt,
            )
        }

        val nextPolicies = linkedMapOf<String, Policy>()
        val nextSources = linkedMapOf<String, PolicySource>()
        for (input in policyInputs) {
            val action = GuardAction.fromWire(input.action) ?: continue
            val severity = Severity.fromWire(input.severity) ?: continue
            nextPolicies[input.id] = Policy(
                id = input.id,
                packId = input.packId,
                priority = input.priority,
                action = action,
                severity = severity,
                description = input.description ?: "",
                direction = input.direction,
                enabled = input.enabled,
                path = input.sourcePath?.takeIf(String::isNotBlank),
                dryRun = input.dryRun,
            )
            if (!input.sourcePath.isNullOrBlank() && input.sourceYaml != null) {
                nextSources[input.id] = PolicySource(input.id, input.sourcePath, input.sourceYaml)
            }
        }

        packs = nextPacks
        policies = nextPolicies
        sources = nextSources
        PolicySyncResult(packsStored = nextPacks.size, policiesStored = nextPolicies.size, syncedAt = now)
    }

    fun listPacks(): List<PolicyPack> = synchronized(lock) { packs.values.toList() }

    fun listPolicies(): List<Policy> = synchronized(lock) { policies.values.sortedBy(Policy::priority) }

    fun enabledPackIds(): List<String> = synchronized(lock) { packs.values.filter(PolicyPack::enabled).map(PolicyPack::id) }

    fun packExists(id: String): Boolean = synchronized(lock) { packs.containsKey(id) }

    fun updatePolicy(id: String, action: GuardAction?, severity: Severity?, priority: Int?): Policy? = synchronized(lock) {
        val current = policies[id] ?: return null
        val updated = current.copy(
            action = action ?: current.action,
            severity = severity ?: current.severity,
            priority = priority ?: current.priority,
        )
        policies[id] = updated
        val pack = packs[updated.packId]
        if (pack != null) packs[updated.packId] = pack.copy(version = pack.version + 1, updatedAt = clock.instant())
        updated
    }

    fun policy(id: String): Policy? = synchronized(lock) { policies[id] }

    fun source(id: String): PolicySource? = synchronized(lock) { sources[id] }
}
