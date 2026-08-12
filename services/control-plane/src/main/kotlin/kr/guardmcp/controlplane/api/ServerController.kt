package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.AuditChain
import kr.guardmcp.controlplane.domain.McpServer
import kr.guardmcp.controlplane.domain.ServerRegistryStore
import kr.guardmcp.controlplane.domain.ServerSummary
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

    private fun toolInventory(serverId: UUID): List<ToolSummary> =
        toolSnapshotStore.statusView(serverId).map { (name, status) -> ToolSummary(name = name, snapshotStatus = status) }
            .sortedBy { it.name }

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
        return toSummary(outcome.server)
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
