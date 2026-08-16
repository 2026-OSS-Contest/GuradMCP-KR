package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.AuditChain
import kr.guardmcp.controlplane.domain.DemoSeed
import kr.guardmcp.controlplane.domain.McpServer
import kr.guardmcp.controlplane.domain.ServerRegistryStore
import kr.guardmcp.controlplane.domain.ServerSummary
import kr.guardmcp.controlplane.domain.ToolRisk
import kr.guardmcp.controlplane.domain.ToolSnapshotStatusView
import kr.guardmcp.controlplane.domain.ToolSnapshotStore
import kr.guardmcp.controlplane.domain.ToolSummary
import kr.guardmcp.controlplane.domain.TrustLevel
import kr.guardmcp.controlplane.domain.TrustLevelChangeEvent
import kr.guardmcp.controlplane.domain.toSummary
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import java.util.UUID

data class ServersResponse(val servers: List<ServerSummary>)

data class TrustChangeRequest(val trustLevel: String, val confirmed: Boolean = false)

@RestController
@RequestMapping("/api/v1")
class ServerController(
    private val registryStore: ServerRegistryStore,
    private val auditChain: AuditChain,
    private val toolSnapshotStore: ToolSnapshotStore,
) {
    /** Lean list shape shared by the console home-page inventory and the gateway registry sync
     *  (§4.1, §6). Per-tool `snapshotStatus` (FR-GW-03 §6.1) is real here even though the SSE
     *  push in [ServerRegistryStore] still sends an empty `tools` list — see that file's note. */
    @GetMapping("/servers")
    fun servers(): ServersResponse = ServersResponse(registryStore.list().map { toSummary(it, toolInventory(it.id)) })

    /**
     * Merges [ToolSnapshotStore]'s real, Postgres-backed drift state (FR-GW-03) with a static
     * demo `risk`/`policies` seed (GMCP-80 §3.1) — tool-level risk scoring has no real backend
     * source yet, matching the console-side gap `ToolSummary`'s doc comment notes. The seed's
     * tool names are unioned into the result even when [ToolSnapshotStore] has never seen them
     * (no `tool-snapshot/approve` or `/tool-observations` call for that server), so this stays a
     * *fixed display seed* rather than silently disappearing once the real feature has no data
     * for it — such an entry reads honestly as `snapshotStatus.state == "unapproved"`.
     */
    private fun toolInventory(serverId: UUID): List<ToolSummary> {
        val statuses = toolSnapshotStore.statusView(serverId)
        val seed = TOOL_RISK_SEED[serverId].orEmpty()
        return (statuses.keys + seed.keys).map { name ->
            val (risk, policies) = seed[name] ?: (ToolRisk.LOW to emptyList())
            ToolSummary(name = name, risk = risk, policies = policies, snapshotStatus = statuses[name] ?: UNAPPROVED_PLACEHOLDER)
        }.sortedBy { it.name }
    }

    /** Full entity — endpoint, connection/tool-snapshot state, and trust-change provenance (§3.1). */
    @GetMapping("/servers/{id}")
    fun server(@PathVariable id: String): McpServer = registryStore.get(parseId(id)) ?: notFound(id)

    @PutMapping("/servers/{id}/trust")
    fun changeTrust(@PathVariable id: String, @RequestBody request: TrustChangeRequest): ServerSummary {
        val serverId = parseId(id)
        val toTrust = TrustLevel.fromWire(request.trustLevel)
            ?: throw ApiException(HttpStatus.BAD_REQUEST, "invalid_trust_level", "unknown trustLevel '${request.trustLevel}'")
        val outcome = registryStore.changeTrust(serverId, toTrust, request.confirmed)
        if (outcome.direction != "none") {
            auditChain.recordTrustChange(
                serverId = id,
                fromTrust = outcome.fromTrust,
                toTrust = toTrust,
                direction = outcome.direction,
                confirmedBy = outcome.server.trustLevelUpdatedBy,
            )
        }
        return toSummary(outcome.server, toolInventory(outcome.server.id))
    }

    /** Audit query surface for the trust-change hash chain (§3.2, §9 — "Replay에서 조회 가능"). */
    @GetMapping("/servers/trust-events")
    fun trustEvents(): List<TrustLevelChangeEvent> = auditChain.trustChangeEvents()

    /** Push channel for the gateway's server-registry cache and the console (§4.1, §5.1: push, not polling). */
    @GetMapping("/servers/stream", produces = [MediaType.TEXT_EVENT_STREAM_VALUE])
    fun stream(): SseEmitter {
        // Bounded rather than infinite: an abandoned connection (client crash, network drop
        // without a clean close) should eventually free its server thread. The gateway's SSE
        // client reconnects on its own (matching the console's `lib/sse.ts` reconnect pattern).
        val emitter = SseEmitter(STREAM_TIMEOUT_MS)
        registryStore.subscribe(emitter)
        return emitter
    }

    private companion object {
        const val STREAM_TIMEOUT_MS = 30 * 60 * 1000L

        /** Demo-only seed (§3.1) — real per-tool risk scoring and policy binding do not exist
         *  yet; see [toolInventory]'s doc comment. */
        val TOOL_RISK_SEED: Map<UUID, Map<String, Pair<ToolRisk, List<String>>>> = mapOf(
            DemoSeed.SERVER_FILE_ID to mapOf(
                "read_file" to (ToolRisk.HIGH to listOf("block_env_file_read")),
                "list_dir" to (ToolRisk.LOW to emptyList()),
            ),
            DemoSeed.SERVER_MAIL_ID to mapOf(
                "send_email" to (ToolRisk.HIGH to listOf("approve_external_email")),
            ),
            DemoSeed.SERVER_DB_ID to mapOf(
                "lookup_customer" to (ToolRisk.MEDIUM to listOf("mask_korean_phone")),
            ),
        )

        val UNAPPROVED_PLACEHOLDER = ToolSnapshotStatusView(
            state = "unapproved", snapshotCapturedAt = null, lastCheckedAt = null, pendingDiffCount = 0, latestDiffId = null,
        )
    }

    private fun parseId(id: String): UUID =
        try {
            UUID.fromString(id)
        } catch (_: IllegalArgumentException) {
            notFound(id)
        }

    private fun notFound(id: String): Nothing =
        throw ApiException(HttpStatus.NOT_FOUND, "server_not_found", "server $id not found")
}
