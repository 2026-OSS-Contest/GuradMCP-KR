package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.EventBroadcaster
import kr.guardmcp.controlplane.domain.GuardAction
import kr.guardmcp.controlplane.domain.GuardEventRepository
import kr.guardmcp.controlplane.domain.Policy
import kr.guardmcp.controlplane.domain.PolicyBenchmarkResultDraft
import kr.guardmcp.controlplane.domain.PolicyBenchmarkResultStore
import kr.guardmcp.controlplane.domain.PolicyPack
import kr.guardmcp.controlplane.domain.PolicyStore
import kr.guardmcp.controlplane.domain.PolicySyncPackInput
import kr.guardmcp.controlplane.domain.PolicySyncPolicyInput
import kr.guardmcp.controlplane.domain.Severity
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.math.BigDecimal
import java.math.RoundingMode
import java.security.MessageDigest
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.ChronoUnit

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
    /** SPEC-POL-04 §3.1/§4.2 (GMCP-77): the policy's own `dry_run:` from the YAML, as the Gateway
     *  resolved it (`default_dry_run` already folded in — see `packRegistry.ts`'s `loadPack`). */
    val dryRun: Boolean = false,
)

data class PolicySyncRequest(val packs: List<PolicySyncPackRequest> = emptyList(), val policies: List<PolicySyncPolicyRequest> = emptyList())

data class PolicySyncResponse(val packsStored: Int, val policiesStored: Int, val syncedAt: Instant)

/** `GET /policies/{id}/source` (fix-api.md §4) — the Policy Chip popover and SCR-302 YAML panel. */
data class PolicyDetailResponse(val id: String, val yaml: String, val path: String)

/** SPEC-POL-04 §6.1 `production.dailySeries[]`. */
data class PolicyStatsDailyPoint(val date: LocalDate, val matchCount: Int, val wouldBlockCount: Int)

/** SPEC-POL-04 §6.1 `production` block: real-traffic dry-run activity, no labels involved. */
data class PolicyStatsProduction(
    val matchCount: Int,
    val verdictBreakdown: Map<String, Int>,
    val wouldEscalateCount: Int,
    val dailySeries: List<PolicyStatsDailyPoint>,
)

/** SPEC-POL-04 §6.1 `benchmark` block: the latest labeled-dataset run, or absent entirely. */
data class PolicyStatsBenchmark(
    val lastRunAt: Instant,
    val datasetVersion: String,
    val normalSampleCount: Int,
    val falsePositiveCount: Int,
    val fpr: Double,
)

/**
 * SPEC-POL-04 §6.1. A superset of the pre-GMCP-77 shape (`window`, `firedLast30d`,
 * `lastTriggeredAt`) rather than a replacement — `attack-lab/benchmark/dryRunStats.ts` and
 * `apps/console/lib/api/types.ts`'s `PolicyStats` both still read exactly those three fields.
 * `firedLast30d`/`lastTriggeredAt` keep their pre-existing meaning unchanged: the trigger
 * count/most-recent-hit over whichever window was actually requested (the field name is a
 * carried-over misnomer — GMCP-80 §3.5 already named it that when the console only ever
 * requested 30 days, and nothing reads it any other way today) — now honest for a `dryRun:
 * true` policy too, where it reports the shadow-match count instead of the hardcoded 0
 * GMCP-118's own comment on `dryRunStats.ts` names as the one change GMCP-77 needed to make.
 * `production`/`benchmark` are the new fields, scoped to the same window.
 */
data class PolicyStatsResponse(
    val policyId: String,
    val dryRun: Boolean,
    val range: String,
    val window: String,
    val firedLast30d: Int,
    val lastTriggeredAt: Instant?,
    val production: PolicyStatsProduction,
    val benchmark: PolicyStatsBenchmark?,
)

/** What the Benchmark Runner (`guardmcp bench run`, §7.1/§7.2) posts after a run completes. */
data class PolicyBenchmarkResultRequest(
    val datasetVersion: String,
    val normalSampleCount: Int,
    val falsePositiveCount: Int,
    val ranAt: Instant? = null,
)

data class PolicyBenchmarkResultResponse(
    val policyId: String,
    val ranAt: Instant,
    val datasetVersion: String,
    val normalSampleCount: Int,
    val falsePositiveCount: Int,
    val fpr: Double,
)

@RestController
@RequestMapping("/api/v1")
class PolicyController(
    private val policyStore: PolicyStore,
    private val guardEventRepository: GuardEventRepository,
    private val benchmarkResultStore: PolicyBenchmarkResultStore,
    private val clock: Clock,
    private val eventBroadcaster: EventBroadcaster,
    /** Same shape as [AuditEventController]'s `revealToken`: a server-side shared secret the
     *  Gateway must present to overwrite the policy registry, blank by default so the endpoint
     *  denies every caller until an operator sets it out of band (NFR-04-style, fix-api.md §1
     *  review: `POST /policies/sync` was reachable by anyone who could reach the Control Plane). */
    @Value("\${security.sync-token:}") private val syncToken: String,
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
     * pack/policy state; there is no other way for it to become non-empty — so an unauthenticated
     * caller able to reach this endpoint could overwrite the entire registry the console renders.
     * Gated by [syncToken] the same way `AuditEventController.reveal` gates on `revealToken`:
     * a blank (unconfigured) token denies every request rather than defaulting open.
     */
    @PostMapping("/policies/sync")
    fun sync(
        @RequestBody request: PolicySyncRequest,
        @RequestHeader(value = SYNC_TOKEN_HEADER, required = false) presentedToken: String?,
    ): PolicySyncResponse {
        if (!hasValidSyncToken(presentedToken)) {
            throw ApiException(HttpStatus.FORBIDDEN, "sync_unauthorized", "policy sync requires a valid sync token")
        }
        val result = policyStore.sync(
            request.packs.map { PolicySyncPackInput(it.packId, it.name, it.description, it.enabled) },
            request.policies.map {
                PolicySyncPolicyInput(
                    id = it.id, packId = it.packId, priority = it.priority, action = it.action, severity = it.severity,
                    description = it.description, direction = it.direction, enabled = it.enabled,
                    sourcePath = it.sourcePath, sourceYaml = it.sourceYaml, dryRun = it.dryRun,
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
     * SPEC-POL-04 §6.1. Works the same for a `dryRun: true` policy and an actionable one — an
     * already-active policy still has a `production` dry-run history from before it was
     * hardened, and a `benchmark` block worth watching for FPR drift (§6.1's closing note).
     *
     * `range` (§6.1) only accepts `7d`/`30d`/`90d` and answers 400 `invalid_range` otherwise.
     * `window` (GMCP-80 §3.5, kept for `attack-lab/benchmark/dryRunStats.ts`) accepts any
     * `<n>d` and answers 400 `invalid_window` otherwise — tightening it to the `range`
     * allowlist would turn that existing caller's `window=3650d` into a break. `range` wins
     * when both are given; the default with neither is `30d`.
     */
    @GetMapping("/policies/{policyId}/stats")
    fun policyStats(
        @PathVariable policyId: String,
        @RequestParam(required = false) range: String?,
        @RequestParam(required = false) window: String?,
    ): PolicyStatsResponse {
        val policy = policyStore.policy(policyId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "policy_not_found", "policy $policyId not found")

        val (requestedRange, windowDays) = when {
            range != null ->
                range to (RANGE_DAYS[range] ?: throw ApiException(HttpStatus.BAD_REQUEST, "invalid_range", "range must be one of ${RANGE_DAYS.keys}"))
            window != null ->
                window to (WINDOW_PATTERN.matchEntire(window)?.groupValues?.get(1)?.toInt()
                    ?: throw ApiException(HttpStatus.BAD_REQUEST, "invalid_window", "window must look like '30d'"))
            else -> DEFAULT_RANGE to RANGE_DAYS.getValue(DEFAULT_RANGE)
        }
        val since = clock.instant().minus(windowDays.toLong(), ChronoUnit.DAYS)

        val stats = if (policy.dryRun) guardEventRepository.dryRunStats(policyId, since) else guardEventRepository.activationStats(policyId, since)
        val production = PolicyStatsProduction(
            matchCount = stats.matchCount,
            verdictBreakdown = withEveryActionKey(stats.verdictBreakdown),
            wouldEscalateCount = stats.wouldEscalateCount,
            dailySeries = stats.dailySeries.map { PolicyStatsDailyPoint(it.date, it.matchCount, it.wouldBlockCount) },
        )

        val benchmark = benchmarkResultStore.latestFor(policyId)?.let {
            PolicyStatsBenchmark(
                lastRunAt = it.ranAt,
                datasetVersion = it.datasetVersion,
                normalSampleCount = it.normalSampleCount,
                falsePositiveCount = it.falsePositiveCount,
                fpr = it.fpr.toDouble(),
            )
        }

        return PolicyStatsResponse(
            policyId = policyId,
            dryRun = policy.dryRun,
            range = requestedRange,
            window = requestedRange,
            firedLast30d = stats.matchCount,
            lastTriggeredAt = stats.lastMatchedAt,
            production = production,
            benchmark = benchmark,
        )
    }

    /**
     * SPEC-POL-04 §6.2/§7.1/§7.2: the Benchmark Runner posts here once a `guardmcp bench run`
     * finishes, so `GET .../stats`'s `benchmark` block has something to read. Not named in the
     * spec's own API list (only the read side is) — this is the natural write side of the
     * append-only table §8.3 asks for.
     */
    @PostMapping("/policies/{policyId}/benchmark-results")
    @ResponseStatus(HttpStatus.CREATED)
    fun submitBenchmarkResult(
        @PathVariable policyId: String,
        @RequestBody request: PolicyBenchmarkResultRequest,
    ): PolicyBenchmarkResultResponse {
        policyStore.policy(policyId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "policy_not_found", "policy $policyId not found")
        if (request.normalSampleCount <= 0) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_normal_sample_count", "normalSampleCount must be positive")
        }
        if (request.falsePositiveCount < 0 || request.falsePositiveCount > request.normalSampleCount) {
            throw ApiException(
                HttpStatus.BAD_REQUEST,
                "invalid_false_positive_count",
                "falsePositiveCount must be between 0 and normalSampleCount",
            )
        }
        val fpr = BigDecimal(request.falsePositiveCount)
            .divide(BigDecimal(request.normalSampleCount), 6, RoundingMode.HALF_UP)
        val record = benchmarkResultStore.insert(
            PolicyBenchmarkResultDraft(
                policyId = policyId,
                ranAt = request.ranAt ?: clock.instant(),
                datasetVersion = request.datasetVersion,
                normalSampleCount = request.normalSampleCount,
                falsePositiveCount = request.falsePositiveCount,
                fpr = fpr,
            ),
        )
        return PolicyBenchmarkResultResponse(
            policyId = record.policyId,
            ranAt = record.ranAt,
            datasetVersion = record.datasetVersion,
            normalSampleCount = record.normalSampleCount,
            falsePositiveCount = record.falsePositiveCount,
            fpr = record.fpr.toDouble(),
        )
    }

    /** Constant-time comparison, and a blank [syncToken] (unconfigured) always denies — same
     *  contract as `AuditEventController.hasValidOperatorToken`. */
    private fun hasValidSyncToken(presentedToken: String?): Boolean {
        if (syncToken.isBlank() || presentedToken.isNullOrBlank()) return false
        return MessageDigest.isEqual(syncToken.toByteArray(), presentedToken.toByteArray())
    }

    private companion object {
        const val DEFAULT_RANGE = "30d"
        val RANGE_DAYS = mapOf("7d" to 7, "30d" to 30, "90d" to 90)
        val WINDOW_PATTERN = Regex("""(\d+)d""")
        private const val SYNC_TOKEN_HEADER = "X-Sync-Token"

        /** §6.1's example always lists all four non-`allow` actions, zero-filled. */
        fun withEveryActionKey(breakdown: Map<String, Int>): Map<String, Int> =
            linkedMapOf(
                "block" to (breakdown["block"] ?: 0),
                "require_approval" to (breakdown["require_approval"] ?: 0),
                "warn" to (breakdown["warn"] ?: 0),
                "mask_then_allow" to (breakdown["mask_then_allow"] ?: 0),
            )
    }
}
