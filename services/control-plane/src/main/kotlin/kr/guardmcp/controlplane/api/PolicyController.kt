package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.EventBroadcaster
import kr.guardmcp.controlplane.domain.GuardAction
import kr.guardmcp.controlplane.domain.GuardEventRepository
import kr.guardmcp.controlplane.domain.Policy
import kr.guardmcp.controlplane.domain.PolicyPack
import kr.guardmcp.controlplane.domain.PolicyStore
import kr.guardmcp.controlplane.domain.PolicySyncPackInput
import kr.guardmcp.controlplane.domain.PolicySyncPolicyInput
import kr.guardmcp.controlplane.domain.Severity
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.time.Clock
import java.time.Instant

data class PolicyPackUpdateRequest(val enabled: Boolean)

data class PolicyUpdateRequest(
    val action: String? = null,
    val severity: String? = null,
    val priority: Int? = null,
)

/** `POST /policies/sync` request body — the Gateway's own `PackState`/`Policy` shape (fix-api.md §1). */
data class PolicySyncPackRequest(val packId: String, val name: String, val description: String? = null, val enabled: Boolean = true)

data class PolicySyncPolicyRequest(
    val id: String,
    val packId: String,
    val priority: Int,
    val action: String,
    val severity: String,
    val description: String? = null,
    val direction: String? = null,
    // Accepted for wire-shape parity with the Gateway's PackState.policies (policySync.ts sends
    // it), but nothing on this side surfaces a policy's `message` yet — there is no console
    // field for it. Kept here rather than dropped so a real sync payload carrying it still
    // deserializes; add a mapping once something reads it instead of reviving this silently.
    val message: String? = null,
    val enabled: Boolean = true,
    val sourcePath: String? = null,
    val sourceYaml: String? = null,
)

data class PolicySyncRequest(val packs: List<PolicySyncPackRequest> = emptyList(), val policies: List<PolicySyncPolicyRequest> = emptyList())

data class PolicySyncResponse(val packsStored: Int, val policiesStored: Int, val syncedAt: Instant)

/** `GET /policies/{id}/source` (fix-api.md §4) — the Policy Chip popover and SCR-302 YAML panel. */
data class PolicyDetailResponse(val id: String, val yaml: String, val path: String)

/**
 * `apps/console/lib/api/types.ts`'s `PolicyStats`. `firedLast30d` names the field the console
 * reads regardless of the requested `window` (SCR-302's table column is always the 30-day
 * count); `window`/`lastTriggeredAt` are additive (GMCP-80 §3.5), not read by the console yet.
 * `dryRun` is never populated: no policy in this system is ever marked dry-run (`PolicyRow
 * .dryRun`'s own comment — GMCP-77, unbuilt), so there is nothing honest to report for it.
 */
data class PolicyStatsResponse(
    val policyId: String,
    val window: String,
    val firedLast30d: Int,
    val lastTriggeredAt: Instant?,
)

@RestController
@RequestMapping("/api/v1")
class PolicyController(
    private val policyStore: PolicyStore,
    private val guardEventRepository: GuardEventRepository,
    private val clock: Clock,
    private val eventBroadcaster: EventBroadcaster,
) {
    @GetMapping("/policy-packs")
    fun policyPacks(): List<PolicyPack> = policyStore.listPacks()

    @GetMapping("/policies")
    fun policies(): List<Policy> = policyStore.listPolicies()

    /**
     * fix-api.md §1: the Gateway is the only process that actually enforces policy packs
     * (`packages/policy-engine`'s loader), and there is no channel back from this store to the
     * Gateway's own enable/disable state — toggling a pack here would change what the console
     * displays without changing what the Gateway does, exactly the false confirmation the doc
     * flags. Read-only until such a channel exists; the console renders the switch disabled.
     */
    @PutMapping("/policy-packs/{packId}")
    fun updatePack(@PathVariable packId: String, @RequestBody request: PolicyPackUpdateRequest): PolicyPack {
        if (!policyStore.packExists(packId)) {
            throw ApiException(HttpStatus.NOT_FOUND, "policy_pack_not_found", "policy pack $packId not found")
        }
        throw ApiException(
            HttpStatus.CONFLICT,
            "policy_pack_toggle_read_only",
            "policy pack $packId is loaded by the gateway from policy-packs/ and cannot be toggled from the console",
        )
    }

    /**
     * fix-api.md §1 (option B): the Gateway calls this once at boot and again after every
     * hot-reload (`packages/gateway/src/controlPlane/policySync.ts`), reporting the pack/policy
     * set it just loaded from `policy-packs/`. This is the only writer of [PolicyStore]'s
     * pack/policy state; there is no other way for it to become non-empty.
     */
    @PostMapping("/policies/sync")
    fun sync(@RequestBody request: PolicySyncRequest): PolicySyncResponse {
        val result = policyStore.sync(
            request.packs.map { PolicySyncPackInput(it.packId, it.name, it.description, it.enabled) },
            request.policies.map {
                PolicySyncPolicyInput(
                    id = it.id, packId = it.packId, priority = it.priority, action = it.action, severity = it.severity,
                    description = it.description, direction = it.direction, enabled = it.enabled,
                    sourcePath = it.sourcePath, sourceYaml = it.sourceYaml,
                )
            },
        )
        // fix-api.md §5: `policy.reloaded` — the SCR-302 hot-reload banner. Fires on the boot
        // sync too, same as [kr.guardmcp.controlplane.domain.ServerRegistryStore]'s own snapshot
        // push does on first connect; harmless (once per gateway start) and simpler than
        // distinguishing "first sync" from "hot-reload" here.
        eventBroadcaster.publish("policy.reloaded", result)
        return PolicySyncResponse(result.packsStored, result.policiesStored, result.syncedAt)
    }

    /** fix-api.md §4: the raw YAML behind a policy id, synced in alongside the policy itself. */
    @GetMapping("/policies/{policyId}/source")
    fun source(@PathVariable policyId: String): PolicyDetailResponse {
        policyStore.policy(policyId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "policy_not_found", "policy $policyId not found")
        val source = policyStore.source(policyId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "policy_source_not_found", "no source is on file yet for policy $policyId")
        return PolicyDetailResponse(id = policyId, yaml = source.yaml, path = source.path)
    }

    @PutMapping("/policies/{policyId}")
    fun updatePolicy(@PathVariable policyId: String, @RequestBody request: PolicyUpdateRequest): Policy {
        val action = request.action?.let {
            GuardAction.fromWire(it)
                ?: throw ApiException(HttpStatus.BAD_REQUEST, "invalid_policy_action", "unknown action '$it'")
        }
        val severity = request.severity?.let {
            Severity.fromWire(it)
                ?: throw ApiException(HttpStatus.BAD_REQUEST, "invalid_policy_severity", "unknown severity '$it'")
        }
        if (request.priority != null && request.priority <= 0) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_policy_priority", "priority must be positive")
        }
        return policyStore.updatePolicy(policyId, action, severity, request.priority)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "policy_not_found", "policy $policyId not found")
    }

    /**
     * `dryRun=true` (GMCP-80 §3.5) always answers `firedLast30d=0`: nothing in this system ever
     * marks a policy as dry-run yet (see [PolicyStatsResponse]'s doc), so there is no dry-run
     * subset of `guard_event` to count. A policy with no trigger history answers 0, not 404 —
     * only an unknown `policyId` is a 404.
     */
    @GetMapping("/policies/{policyId}/stats")
    fun policyStats(
        @PathVariable policyId: String,
        @RequestParam(required = false, defaultValue = "30d") window: String,
        @RequestParam(required = false, defaultValue = "false") dryRun: Boolean,
    ): PolicyStatsResponse {
        policyStore.policy(policyId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "policy_not_found", "policy $policyId not found")
        val windowDays = WINDOW_PATTERN.matchEntire(window)?.groupValues?.get(1)?.toInt()
            ?: throw ApiException(HttpStatus.BAD_REQUEST, "invalid_window", "window must look like '30d'")
        if (dryRun) return PolicyStatsResponse(policyId, window, firedLast30d = 0, lastTriggeredAt = null)

        val since = clock.instant().minus(windowDays.toLong(), java.time.temporal.ChronoUnit.DAYS)
        val stats = guardEventRepository.policyStats(policyId, since)
        return PolicyStatsResponse(policyId, window, stats.triggeredCount, stats.lastTriggeredAt)
    }

    private companion object {
        val WINDOW_PATTERN = Regex("""(\d+)d""")
    }
}
