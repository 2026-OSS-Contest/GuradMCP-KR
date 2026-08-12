package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.DemoSeed
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.SpringBootTest
import java.util.UUID

/**
 * FR-GW-03 (GMCP-65) §9 acceptance criteria: snapshot capture, all four diff types,
 * `GET /servers` `snapshotStatus`, and acknowledge semantics.
 *
 * Most tests use a random server id: `GET /servers/{id}/tool-snapshot` and the diff
 * endpoints work for any id, since [kr.guardmcp.controlplane.domain.ToolSnapshotStore]
 * is keyed purely by the id in the path. Tests that assert on `GET /servers` itself use
 * [DemoSeed.SERVER_DB_ID] instead, because that endpoint only lists servers
 * [kr.guardmcp.controlplane.domain.ServerRegistryStore] already knows about — and give
 * each such test its own tool name, since the seeded server (and its Postgres-backed
 * snapshot/diff rows) is shared state across this whole test class.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ToolSnapshotApiTest : ApiTestSupport() {
    private fun readFileTool(
        name: String = "read_file",
        description: String = "파일 시스템에서 텍스트 파일을 읽는다.",
        schema: Map<String, Any?> = mapOf("type" to "object", "properties" to mapOf("path" to mapOf("type" to "string"))),
    ) = mapOf("name" to name, "description" to description, "inputSchema" to schema, "fingerprint" to "fp-${description.hashCode()}-${schema.hashCode()}")

    private fun approve(serverId: UUID, tools: List<Map<String, Any?>>, capturedBy: String? = null) =
        send("POST", "/api/v1/servers/$serverId/tool-snapshot/approve", mapOf("tools" to tools, "capturedBy" to capturedBy))

    private fun reportObservation(serverId: UUID, tools: List<Map<String, Any?>>, diffs: List<Map<String, Any?>> = emptyList()) =
        send("POST", "/api/v1/servers/$serverId/tool-observations", mapOf("tools" to tools, "diffs" to diffs))

    private fun serverSummary(serverId: UUID): Map<String, Any?> {
        val servers = parseMap(get("/api/v1/servers").body())["servers"] as List<Map<String, Any?>>
        return servers.first { it["id"] == serverId.toString() }
    }

    @Suppress("UNCHECKED_CAST")
    private fun toolEntry(serverId: UUID, toolName: String): Map<String, Any?> =
        (serverSummary(serverId)["tools"] as List<Map<String, Any?>>).first { it["name"] == toolName }

    @Test
    fun `a server with no approved snapshot reports unapproved and is excluded from diffing`() {
        val serverId = UUID.randomUUID()
        val baseline = get("/api/v1/servers/$serverId/tool-snapshot")
        assertEquals(200, baseline.statusCode())
        assertEquals(false, parseMap(baseline.body())["approved"])
        assertEquals(emptyList<Any>(), parseMap(baseline.body())["tools"])
    }

    @Test
    fun `approving a server captures an active snapshot with the given fingerprints`() {
        val serverId = UUID.randomUUID()
        val response = approve(serverId, listOf(readFileTool()), capturedBy = "operator-1")
        assertEquals(200, response.statusCode())
        val body = parseMap(response.body())
        assertEquals(true, body["approved"])
        val tools = body["tools"] as List<Map<String, Any?>>
        assertEquals(1, tools.size)
        assertEquals("read_file", tools[0]["toolName"])

        val baseline = parseMap(get("/api/v1/servers/$serverId/tool-snapshot").body())
        assertEquals(true, baseline["approved"])
    }

    @Test
    fun `unapproved server tools still surface in GET servers via observation, with state unapproved`() {
        val serverId = DemoSeed.SERVER_DB_ID
        val toolName = "read_file_unapproved"
        val response = reportObservation(serverId, listOf(readFileTool(name = toolName)))
        assertEquals(200, response.statusCode())

        val tool = toolEntry(serverId, toolName)
        val snapshotStatus = tool["snapshotStatus"] as Map<String, Any?>
        assertEquals("unapproved", snapshotStatus["state"])
        assertNotNull(snapshotStatus["lastCheckedAt"])
        assertEquals(null, snapshotStatus["snapshotCapturedAt"])
    }

    @Test
    fun `an approved tool with no reported drift reads as in_sync`() {
        val serverId = DemoSeed.SERVER_DB_ID
        val tool = readFileTool(name = "read_file_insync")
        approve(serverId, listOf(tool))
        reportObservation(serverId, listOf(tool))

        val snapshotStatus = toolEntry(serverId, "read_file_insync")["snapshotStatus"] as Map<String, Any?>
        assertEquals("in_sync", snapshotStatus["state"])
        assertEquals(0, (snapshotStatus["pendingDiffCount"] as Number).toInt())
    }

    @Test
    fun `description_changed diff is recorded, queryable, and reflected in GET servers`() {
        val serverId = DemoSeed.SERVER_DB_ID
        val toolName = "read_file_desc_drift"
        approve(serverId, listOf(readFileTool(name = toolName)))

        val before = mapOf("description" to "파일 시스템에서 텍스트 파일을 읽는다.")
        val after = mapOf("description" to "파일 시스템 경로 또는 원격 URL에서 콘텐츠를 읽는다.")
        val report = reportObservation(
            serverId,
            listOf(readFileTool(name = toolName, description = "파일 시스템 경로 또는 원격 URL에서 콘텐츠를 읽는다.")),
            listOf(mapOf("toolName" to toolName, "diffType" to "description_changed", "before" to before, "after" to after)),
        )
        assertEquals(200, report.statusCode())
        assertEquals(1, (parseMap(report.body())["diffsRecorded"] as Number).toInt())

        val diffsResponse = get("/api/v1/servers/$serverId/tools/$toolName/diffs")
        assertEquals(200, diffsResponse.statusCode())
        val diffs = parseMap(diffsResponse.body())["diffs"] as List<Map<String, Any?>>
        assertEquals(1, diffs.size)
        assertEquals("description_changed", diffs[0]["diffType"])
        assertEquals(before, diffs[0]["before"])
        assertEquals(after, diffs[0]["after"])
        assertEquals(false, diffs[0]["acknowledged"])

        val snapshotStatus = toolEntry(serverId, toolName)["snapshotStatus"] as Map<String, Any?>
        assertEquals("drift_detected", snapshotStatus["state"])
        assertEquals(1, (snapshotStatus["pendingDiffCount"] as Number).toInt())
        assertEquals(diffs[0]["id"], snapshotStatus["latestDiffId"])
    }

    @Test
    fun `schema_changed diff is recorded and queryable`() {
        val serverId = UUID.randomUUID()
        approve(serverId, listOf(readFileTool()))
        val after = mapOf("description" to readFileTool()["description"], "inputSchema" to mapOf("type" to "object", "properties" to mapOf("path" to mapOf("type" to "string"), "url" to mapOf("type" to "string"))))
        reportObservation(
            serverId,
            listOf(readFileTool(schema = mapOf("type" to "object", "properties" to mapOf("path" to mapOf("type" to "string"), "url" to mapOf("type" to "string"))))),
            listOf(mapOf("toolName" to "read_file", "diffType" to "schema_changed", "before" to null, "after" to after)),
        )

        val diffs = parseMap(get("/api/v1/servers/$serverId/tools/read_file/diffs").body())["diffs"] as List<Map<String, Any?>>
        assertEquals(1, diffs.size)
        assertEquals("schema_changed", diffs[0]["diffType"])
    }

    @Test
    fun `tool_added diff is recorded for a tool the baseline never saw`() {
        val serverId = UUID.randomUUID()
        approve(serverId, listOf(readFileTool()))
        val newTool = mapOf("name" to "delete_file", "description" to "removes a file", "inputSchema" to mapOf("type" to "object"), "fingerprint" to "delete-file-fp")
        reportObservation(
            serverId,
            listOf(readFileTool(), newTool),
            listOf(mapOf("toolName" to "delete_file", "diffType" to "tool_added", "before" to null, "after" to mapOf("description" to "removes a file"))),
        )

        val diffs = parseMap(get("/api/v1/servers/$serverId/tools/delete_file/diffs").body())["diffs"] as List<Map<String, Any?>>
        assertEquals(1, diffs.size)
        assertEquals("tool_added", diffs[0]["diffType"])
        assertEquals(null, diffs[0]["before"])
    }

    @Test
    fun `tool_removed diff is recorded for a baseline tool absent from the latest observation`() {
        val serverId = UUID.randomUUID()
        approve(serverId, listOf(readFileTool(), mapOf("name" to "legacy_tool", "description" to "old", "inputSchema" to emptyMap<String, Any?>(), "fingerprint" to "legacy-fp")))
        reportObservation(
            serverId,
            listOf(readFileTool()),
            listOf(mapOf("toolName" to "legacy_tool", "diffType" to "tool_removed", "before" to mapOf("description" to "old"), "after" to null)),
        )

        val diffs = parseMap(get("/api/v1/servers/$serverId/tools/legacy_tool/diffs").body())["diffs"] as List<Map<String, Any?>>
        assertEquals(1, diffs.size)
        assertEquals("tool_removed", diffs[0]["diffType"])
        assertEquals(null, diffs[0]["after"])
    }

    @Test
    fun `acknowledging a diff clears it from the pending list without touching the snapshot`() {
        val serverId = DemoSeed.SERVER_DB_ID
        val toolName = "read_file_ack"
        approve(serverId, listOf(readFileTool(name = toolName)))
        reportObservation(
            serverId,
            listOf(readFileTool(name = toolName, description = "변경된 설명")),
            listOf(mapOf("toolName" to toolName, "diffType" to "description_changed", "before" to mapOf("description" to "old"), "after" to mapOf("description" to "변경된 설명"))),
        )
        val diffId = (parseMap(get("/api/v1/servers/$serverId/tools/$toolName/diffs").body())["diffs"] as List<Map<String, Any?>>).first()["id"]

        val ackResponse = send("POST", "/api/v1/servers/$serverId/tools/$toolName/diffs/$diffId/acknowledge", mapOf("acknowledgedBy" to "operator-1"))
        assertEquals(200, ackResponse.statusCode())
        assertEquals(true, parseMap(ackResponse.body())["acknowledged"])

        val remainingDiffs = parseMap(get("/api/v1/servers/$serverId/tools/$toolName/diffs").body())["diffs"] as List<Map<String, Any?>>
        assertTrue(remainingDiffs.isEmpty())

        // §9 AC-4: "재승인 API 호출 전까지 동일 변경에 대해 재차 조회 시 acknowledged: true 상태가
        // 유지된다" — the default (pending-only) view can never show this, since acknowledging is
        // exactly what removes a diff from it; includeAcknowledged=true is the only way to observe
        // that the row itself stuck.
        val allDiffs = parseMap(get("/api/v1/servers/$serverId/tools/$toolName/diffs?includeAcknowledged=true").body())["diffs"] as List<Map<String, Any?>>
        assertEquals(1, allDiffs.size)
        assertEquals(diffId, allDiffs[0]["id"])
        assertEquals(true, allDiffs[0]["acknowledged"])
        assertEquals("operator-1", allDiffs[0]["acknowledgedBy"])
        assertNotNull(allDiffs[0]["acknowledgedAt"])
        // Re-querying yet again — not just once — still shows the same acknowledged row,
        // confirming it doesn't revert on a later, unrelated read.
        val allDiffsAgain = parseMap(get("/api/v1/servers/$serverId/tools/$toolName/diffs?includeAcknowledged=true").body())["diffs"] as List<Map<String, Any?>>
        assertEquals(true, allDiffsAgain[0]["acknowledged"])

        // Re-querying reflects the acknowledged state staying put — it isn't re-flagged pending
        // on a later, unrelated read (§9 AC-4).
        val snapshotStatus = toolEntry(serverId, toolName)["snapshotStatus"] as Map<String, Any?>
        assertEquals("in_sync", snapshotStatus["state"])

        // The baseline itself is untouched by acknowledgement — still the original description,
        // not the drifted one (§9 AC-4: "diff 확인 후에도 스냅샷 자체는 변경되지 않아야 하며").
        val baseline = parseMap(get("/api/v1/servers/$serverId/tool-snapshot").body())["tools"] as List<Map<String, Any?>>
        assertEquals("파일 시스템에서 텍스트 파일을 읽는다.", baseline.first { it["toolName"] == toolName }["description"])
    }

    @Test
    fun `acknowledging an unknown diff id is rejected as not found`() {
        val serverId = UUID.randomUUID()
        approve(serverId, listOf(readFileTool()))
        val response = send("POST", "/api/v1/servers/$serverId/tools/read_file/diffs/${UUID.randomUUID()}/acknowledge", emptyMap<String, Any?>())
        assertEquals(404, response.statusCode())
        assertEquals("tool_diff_not_found", parseMap(response.body())["code"])
    }

    @Test
    fun `reporting the same drift twice does not duplicate the pending diff`() {
        // The gateway has no persistent upstream connection, so it detects drift on every
        // tools/list call that passes through it — an Agent calling tools/list repeatedly
        // while a tool sits drifted-but-unacknowledged must not inflate pendingDiffCount.
        val serverId = DemoSeed.SERVER_MAIL_ID
        val toolName = "read_file_repeat"
        approve(serverId, listOf(readFileTool(name = toolName)))
        val diffPayload = mapOf(
            "toolName" to toolName, "diffType" to "description_changed",
            "before" to mapOf("description" to "old"), "after" to mapOf("description" to "new"),
        )
        val tampered = readFileTool(name = toolName, description = "new")
        reportObservation(serverId, listOf(tampered), listOf(diffPayload))
        reportObservation(serverId, listOf(tampered), listOf(diffPayload))
        reportObservation(serverId, listOf(tampered), listOf(diffPayload))

        val diffs = parseMap(get("/api/v1/servers/$serverId/tools/$toolName/diffs").body())["diffs"] as List<Map<String, Any?>>
        assertEquals(1, diffs.size)

        val snapshotStatus = toolEntry(serverId, toolName)["snapshotStatus"] as Map<String, Any?>
        assertEquals(1, (snapshotStatus["pendingDiffCount"] as Number).toInt())
    }

    @Test
    fun `re-approving a server supersedes the previous snapshot rather than duplicating it`() {
        val serverId = UUID.randomUUID()
        approve(serverId, listOf(readFileTool()), capturedBy = "system")
        approve(serverId, listOf(readFileTool(description = "재승인된 새 설명")), capturedBy = "operator-2")

        val baseline = parseMap(get("/api/v1/servers/$serverId/tool-snapshot").body())["tools"] as List<Map<String, Any?>>
        assertEquals(1, baseline.size)
        assertEquals("재승인된 새 설명", baseline[0]["description"])
    }

    @Test
    fun `an empty tool list is rejected on approve`() {
        val response = approve(UUID.randomUUID(), emptyList())
        assertEquals(400, response.statusCode())
        assertEquals("empty_tool_list", parseMap(response.body())["code"])
    }

    @Test
    fun `unknown diffType on observation report is rejected`() {
        val serverId = UUID.randomUUID()
        val response = reportObservation(serverId, listOf(readFileTool()), listOf(mapOf("toolName" to "read_file", "diffType" to "bogus", "before" to null, "after" to null)))
        assertEquals(400, response.statusCode())
        assertEquals("invalid_diff_type", parseMap(response.body())["code"])
    }
}
