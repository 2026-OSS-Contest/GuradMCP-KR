package kr.guardmcp.controlplane.api

import com.fasterxml.jackson.databind.ObjectMapper
import kr.guardmcp.controlplane.domain.ApprovedToolInput
import kr.guardmcp.controlplane.domain.ReportedDiff
import kr.guardmcp.controlplane.domain.ToolDefinitionDiff
import kr.guardmcp.controlplane.domain.ToolDiffType
import kr.guardmcp.controlplane.domain.ToolObservation
import kr.guardmcp.controlplane.domain.ToolSnapshot
import kr.guardmcp.controlplane.domain.ToolSnapshotStore
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.time.Clock
import java.time.Instant
import java.util.UUID

data class BaselineToolEntry(
    val toolName: String,
    val description: String,
    val inputSchema: Any?,
    val fingerprint: String,
    val capturedAt: Instant,
)

data class ToolSnapshotBaselineResponse(val approved: Boolean, val tools: List<BaselineToolEntry>)

data class ApproveToolInput(val name: String, val description: String, val inputSchema: Any?, val fingerprint: String)
data class ApproveSnapshotRequest(val tools: List<ApproveToolInput> = emptyList(), val capturedBy: String? = null)

data class ToolDiffView(
    val id: UUID,
    val diffType: String,
    val before: Any?,
    val after: Any?,
    val detectedAt: Instant,
    val acknowledged: Boolean,
    val acknowledgedBy: String? = null,
    val acknowledgedAt: Instant? = null,
)

data class ToolDiffsResponse(val toolName: String, val diffs: List<ToolDiffView>)

data class AcknowledgeRequest(val acknowledgedBy: String? = null)

data class ReapproveRequest(val capturedBy: String? = null)

data class ObservedToolInput(val name: String, val description: String, val inputSchema: Any?, val fingerprint: String)
data class ReportedDiffInput(val toolName: String, val diffType: String, val before: Any?, val after: Any?)
data class ToolObservationReportRequest(
    val observedAt: Instant? = null,
    val tools: List<ObservedToolInput> = emptyList(),
    val diffs: List<ReportedDiffInput> = emptyList(),
)
data class ToolObservationReportResponse(val toolsStored: Int, val diffsRecorded: Int)

/**
 * FR-GW-03 endpoints (spec §6.2, §6.3, plus two endpoints the spec leaves unnamed):
 *  - `GET/POST .../tool-snapshot` is the gateway-facing baseline sync + admin (re-)approval
 *    channel (spec §5.1.2, §5.1.4 — "관리자 전용 엔드포인트로 제공", no path given there).
 *  - `POST .../tool-observations` is the gateway→control-plane drift report channel that
 *    feeds `GET /servers`'s `snapshotStatus` (spec §5.2 step 3, §6.1). Internal; not a
 *    console-facing endpoint.
 *  - `GET .../diffs` and `POST .../diffs/{id}/acknowledge` are exactly spec §6.2/§6.3.
 *  - `POST .../tools/{toolName}/reapprove` is the console's false-positive path: re-approves
 *    one tool from its latest reported observation, so an operator who has reviewed a diff
 *    and judged it benign doesn't have to hand-type the definition back through `/approve`
 *    (which also still works for bulk/initial approval).
 */
@RestController
@RequestMapping("/api/v1")
class ToolSnapshotController(private val store: ToolSnapshotStore, private val clock: Clock) {
    private val objectMapper = ObjectMapper()

    @GetMapping("/servers/{id}/tool-snapshot")
    fun baseline(@PathVariable id: String): ToolSnapshotBaselineResponse {
        val snapshots = store.activeSnapshots(parseId(id))
        return ToolSnapshotBaselineResponse(approved = snapshots.isNotEmpty(), tools = snapshots.map(::toBaselineEntry))
    }

    @PostMapping("/servers/{id}/tool-snapshot/approve")
    fun approve(@PathVariable id: String, @RequestBody request: ApproveSnapshotRequest): ToolSnapshotBaselineResponse {
        if (request.tools.isEmpty()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "empty_tool_list", "tools must not be empty")
        }
        val capturedBy = request.capturedBy?.takeIf { it.isNotBlank() } ?: "system"
        val inputs = request.tools.map {
            ApprovedToolInput(name = it.name, description = it.description, inputSchema = writeJson(it.inputSchema), fingerprint = it.fingerprint)
        }
        val approved = store.approve(parseId(id), capturedBy, inputs)
        return ToolSnapshotBaselineResponse(approved = true, tools = approved.map(::toBaselineEntry))
    }

    @PostMapping("/servers/{id}/tools/{toolName}/reapprove")
    fun reapprove(
        @PathVariable id: String,
        @PathVariable toolName: String,
        @RequestBody(required = false) request: ReapproveRequest?,
    ): ToolSnapshotBaselineResponse {
        val capturedBy = request?.capturedBy?.takeIf { it.isNotBlank() } ?: "console"
        val snapshot = store.reapprove(parseId(id), toolName, capturedBy)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "tool_not_observed", "no observation for $toolName on server $id")
        return ToolSnapshotBaselineResponse(approved = true, tools = listOf(toBaselineEntry(snapshot)))
    }

    /** `includeAcknowledged=true` is spec §9 AC-4's only way to observe that an acknowledged
     *  diff's `acknowledged: true` sticks around — the default (unacknowledged-only) view the
     *  popover (spec §6.2) uses can never show it, since acknowledging is exactly what removes
     *  a diff from that list. */
    @GetMapping("/servers/{id}/tools/{toolName}/diffs")
    fun diffs(
        @PathVariable id: String,
        @PathVariable toolName: String,
        @RequestParam(defaultValue = "false") includeAcknowledged: Boolean,
    ): ToolDiffsResponse {
        val serverId = parseId(id)
        val diffs = if (includeAcknowledged) store.allDiffs(serverId, toolName) else store.pendingDiffs(serverId, toolName)
        return ToolDiffsResponse(toolName, diffs.map(::toDiffView))
    }

    @PostMapping("/servers/{id}/tools/{toolName}/diffs/{diffId}/acknowledge")
    fun acknowledge(
        @PathVariable id: String,
        @PathVariable toolName: String,
        @PathVariable diffId: String,
        @RequestBody(required = false) request: AcknowledgeRequest?,
    ): ToolDiffView {
        // No console auth exists yet (mirrors ServerRegistryStore.changeTrust's own note).
        val acknowledgedBy = request?.acknowledgedBy?.takeIf { it.isNotBlank() } ?: "console"
        val diff = store.acknowledge(parseId(id), toolName, parseUuid(diffId), acknowledgedBy)
        return toDiffView(diff)
    }

    @PostMapping("/servers/{id}/tool-observations")
    fun reportObservation(@PathVariable id: String, @RequestBody request: ToolObservationReportRequest): ToolObservationReportResponse {
        val serverId = parseId(id)
        val observedAt = request.observedAt ?: clock.instant()
        for (tool in request.tools) {
            store.upsertObservation(
                ToolObservation(
                    serverId = serverId, toolName = tool.name, description = tool.description,
                    inputSchema = writeJson(tool.inputSchema), fingerprint = tool.fingerprint, observedAt = observedAt,
                ),
            )
        }
        val diffs = if (request.diffs.isEmpty()) {
            emptyList()
        } else {
            store.recordDiffs(
                serverId,
                request.diffs.map {
                    val diffType = ToolDiffType.fromWire(it.diffType)
                        ?: throw ApiException(HttpStatus.BAD_REQUEST, "invalid_diff_type", "unknown diffType '${it.diffType}'")
                    ReportedDiff(toolName = it.toolName, diffType = diffType, before = it.before?.let(::writeJson), after = it.after?.let(::writeJson))
                },
            )
        }
        return ToolObservationReportResponse(toolsStored = request.tools.size, diffsRecorded = diffs.size)
    }

    private fun toBaselineEntry(snapshot: ToolSnapshot) = BaselineToolEntry(
        toolName = snapshot.toolName, description = snapshot.description, inputSchema = readJson(snapshot.inputSchema),
        fingerprint = snapshot.fingerprint, capturedAt = snapshot.capturedAt,
    )

    private fun toDiffView(diff: ToolDefinitionDiff) = ToolDiffView(
        id = diff.id, diffType = diff.diffType.wire, before = diff.before?.let(::readJson), after = diff.after?.let(::readJson),
        detectedAt = diff.detectedAt, acknowledged = diff.acknowledged,
        acknowledgedBy = diff.acknowledgedBy, acknowledgedAt = diff.acknowledgedAt,
    )

    private fun readJson(json: String): Any? = objectMapper.readValue(json, Any::class.java)

    private fun writeJson(value: Any?): String = objectMapper.writeValueAsString(value)

    private fun parseId(id: String): UUID =
        try {
            UUID.fromString(id)
        } catch (_: IllegalArgumentException) {
            throw ApiException(HttpStatus.NOT_FOUND, "server_not_found", "server $id not found")
        }

    private fun parseUuid(id: String): UUID =
        try {
            UUID.fromString(id)
        } catch (_: IllegalArgumentException) {
            throw ApiException(HttpStatus.NOT_FOUND, "diff_not_found", "diff $id not found")
        }
}
