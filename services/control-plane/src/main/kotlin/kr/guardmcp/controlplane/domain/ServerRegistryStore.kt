package kr.guardmcp.controlplane.domain

import com.fasterxml.jackson.annotation.JsonValue
import org.springframework.stereotype.Component
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import java.time.Clock
import java.time.Instant
import java.util.UUID

/**
 * Trust grade for an upstream MCP server (FR-GW-02 §3.1). `rank` orders the
 * grades so the store can tell an upgrade from a downgrade without a lookup
 * table (§5.1: "untrusted < limited < trusted").
 */
enum class TrustLevel(@get:JsonValue val wire: String, val rank: Int) {
    UNTRUSTED("untrusted", 0),
    LIMITED("limited", 1),
    TRUSTED("trusted", 2);

    companion object {
        fun fromWire(value: String): TrustLevel? = entries.firstOrNull { it.wire == value }
    }
}

enum class ConnectionStatus(@get:JsonValue val wire: String) {
    CONNECTED("connected"),
    DISCONNECTED("disconnected");

    companion object {
        fun fromWire(value: String): ConnectionStatus? = entries.firstOrNull { it.wire == value }
    }
}

data class McpServer(
    val id: UUID,
    val name: String,
    val endpoint: String,
    val trustLevel: TrustLevel,
    val connectionStatus: ConnectionStatus,
    val toolSnapshotHash: String?,
    val createdAt: Instant,
    val updatedAt: Instant,
    val trustLevelUpdatedAt: Instant,
    val trustLevelUpdatedBy: String?,
)

/**
 * Per-tool inventory entry (FR-GW-03 §6.1). `risk`/`policies` have no real backend source
 * yet — tool-level risk scoring and policy-to-tool binding are a gap this ticket does not
 * close (`apps/console/lib/api/types.ts` flags the same gap on the console side) — so they
 * carry placeholder defaults rather than fabricated-looking real data. `snapshotStatus` is
 * FR-GW-03's actual deliverable and is always real, sourced from [ToolSnapshotStore.statusView].
 */
data class ToolSummary(
    val name: String,
    val risk: String = "low",
    val policies: List<String> = emptyList(),
    val snapshotStatus: ToolSnapshotStatusView,
)

/**
 * Lean projection served by the list endpoint and the sync stream — the shape the gateway
 * registry cache and the console home-page inventory both consume (§4.1, §6). The richer
 * [McpServer] entity (endpoint, timestamps, tool snapshot) is reserved for the detail endpoint.
 * `tools` is populated only by [kr.guardmcp.controlplane.api.ServerController.servers] (the
 * REST list endpoint, FR-GW-03 §6.1) — the trust-change SSE broadcast in this file still calls
 * [toSummary] with the default empty list, since neither the gateway's trust-registry sync nor
 * the console (which reads tool inventory over REST, not SSE) needs per-tool data on that push.
 */
data class ServerSummary(
    val id: String,
    val name: String,
    val connected: Boolean,
    val trust: String,
    val tools: List<ToolSummary> = emptyList(),
)

class ServerNotFoundException(val id: String) : RuntimeException("server $id not found")

/** §5.1: an upgrade without `confirmed: true` must not change anything; it only reports impact. */
class TrustUpgradeRequiresConfirmationException(
    val server: McpServer,
    val toTrust: TrustLevel,
    val affectedPolicyCount: Int,
) : RuntimeException("upgrading ${server.id} from ${server.trustLevel.wire} to ${toTrust.wire} requires confirmation")

/**
 * Server registry (FR-GW-02 §3.1). Follows the same in-memory
 * `@Component` + `synchronized(lock)` + `linkedMapOf` shape as [PolicyStore]
 * and [ApprovalStore] — this codebase's stores are the entity and repository
 * in one, with no separate JPA layer. [infra/postgres/002-mcp-servers.sql]
 * mirrors this seed data for parity with the Compose demo seed, same as
 * `001-demo-seed.sql` mirrors [PolicyStore]/[GuardEventStore]/[ApprovalStore].
 */
@Component
class ServerRegistryStore(private val clock: Clock, private val policyStore: PolicyStore) {
    private val lock = Any()
    private val servers = linkedMapOf<UUID, McpServer>()
    private val emitters = mutableListOf<SseEmitter>()

    init {
        listOf(
            McpServer(
                id = DemoSeed.SERVER_FILE_ID, name = "file-server", endpoint = "http://demo-mcp-tools:3003",
                trustLevel = TrustLevel.LIMITED, connectionStatus = ConnectionStatus.CONNECTED, toolSnapshotHash = null,
                createdAt = DemoSeed.SEEDED_AT, updatedAt = DemoSeed.SEEDED_AT, trustLevelUpdatedAt = DemoSeed.SEEDED_AT, trustLevelUpdatedBy = null,
            ),
            McpServer(
                id = DemoSeed.SERVER_MAIL_ID, name = "mail-server", endpoint = "http://mail-server.internal:3004",
                trustLevel = TrustLevel.TRUSTED, connectionStatus = ConnectionStatus.CONNECTED, toolSnapshotHash = null,
                createdAt = DemoSeed.SEEDED_AT, updatedAt = DemoSeed.SEEDED_AT, trustLevelUpdatedAt = DemoSeed.SEEDED_AT, trustLevelUpdatedBy = null,
            ),
            McpServer(
                id = DemoSeed.SERVER_DB_ID, name = "db-server", endpoint = "http://db-server.internal:3005",
                // Fail-safe default (§3.1, §5.2): an unreviewed server starts untrusted.
                trustLevel = TrustLevel.UNTRUSTED, connectionStatus = ConnectionStatus.DISCONNECTED, toolSnapshotHash = null,
                createdAt = DemoSeed.SEEDED_AT, updatedAt = DemoSeed.SEEDED_AT, trustLevelUpdatedAt = DemoSeed.SEEDED_AT, trustLevelUpdatedBy = null,
            ),
        ).forEach { servers[it.id] = it }
    }

    fun list(): List<McpServer> = synchronized(lock) { servers.values.toList() }

    fun get(id: UUID): McpServer? = synchronized(lock) { servers[id] }

    /** Outcome of a trust-change request; `direction` is `none` for a same-grade no-op (§5.1). */
    data class TrustChangeOutcome(val server: McpServer, val direction: String, val fromTrust: TrustLevel)

    fun changeTrust(id: UUID, toTrust: TrustLevel, confirmed: Boolean): TrustChangeOutcome {
        var broadcastSnapshot: List<McpServer>? = null
        val outcome = synchronized(lock) {
            val current = servers[id] ?: throw ServerNotFoundException(id.toString())
            if (toTrust == current.trustLevel) return@synchronized TrustChangeOutcome(current, "none", current.trustLevel)

            val isUpgrade = toTrust.rank > current.trustLevel.rank
            if (isUpgrade && !confirmed) {
                throw TrustUpgradeRequiresConfirmationException(current, toTrust, affectedPolicyCount(current.trustLevel))
            }
            val now = clock.instant()
            val updated = current.copy(
                trustLevel = toTrust,
                updatedAt = now,
                trustLevelUpdatedAt = now,
                // No console auth exists yet (§3.1); an upgrade that was explicitly confirmed
                // still records who confirmed it as "console" rather than leaving it null.
                trustLevelUpdatedBy = if (isUpgrade) "console" else null,
            )
            servers[id] = updated
            broadcastSnapshot = servers.values.toList()
            TrustChangeOutcome(updated, if (isUpgrade) "upgrade" else "downgrade", current.trustLevel)
        }
        // Push outside the lock: broadcasting must never block the mutation that triggered it,
        // and an SSE write can be slow if a subscriber is stalled (§5.1: downgrade must not wait
        // on the polling cadence, but it also must not stall on a stuck client).
        broadcastSnapshot?.let(::broadcast)
        return outcome
    }

    /**
     * Rough impact estimate for the upgrade-confirmation prompt (§5.1: "차단 정책 수 등").
     * The control plane's policy model here is a simplified in-memory mirror with no `match`
     * block (real DSL matching lives in the gateway/policy-engine, loaded from policy-packs
     * YAML) — so this counts currently enabled blocking/approval-gate policies system-wide as
     * a proxy for "what might stop applying," rather than resolving per-server `server_trust`
     * targeting precisely.
     */
    private fun affectedPolicyCount(currentTrust: TrustLevel): Int {
        if (currentTrust == TrustLevel.TRUSTED) return 0
        return policyStore.listPolicies().count { it.action == GuardAction.BLOCK || it.action == GuardAction.REQUIRE_APPROVAL }
    }

    /** §5.1: change is pushed to subscribers immediately rather than left to a poll interval. */
    fun subscribe(emitter: SseEmitter) {
        val snapshot = synchronized(lock) {
            emitters += emitter
            servers.values.toList()
        }
        emitter.onCompletion { synchronized(lock) { emitters -= emitter } }
        emitter.onTimeout { emitter.complete(); synchronized(lock) { emitters -= emitter } }
        emitter.onError { synchronized(lock) { emitters -= emitter } }
        sendSnapshot(emitter, snapshot)
    }

    private fun broadcast(snapshot: List<McpServer>) {
        val targets = synchronized(lock) { emitters.toList() }
        for (emitter in targets) sendSnapshot(emitter, snapshot)
    }

    private fun sendSnapshot(emitter: SseEmitter, snapshot: List<McpServer>) {
        try {
            emitter.send(SseEmitter.event().name("servers.snapshot").data(mapOf("servers" to snapshot.map(::toSummary))))
        } catch (exception: Exception) {
            // A failed write means the client is gone; finish the async request explicitly
            // instead of leaving it for Tomcat's own timeout to notice.
            synchronized(lock) { emitters -= emitter }
            emitter.completeWithError(exception)
        }
    }
}

fun toSummary(server: McpServer, tools: List<ToolSummary> = emptyList()): ServerSummary =
    ServerSummary(id = server.id.toString(), name = server.name, connected = server.connectionStatus == ConnectionStatus.CONNECTED, trust = server.trustLevel.wire, tools = tools)
