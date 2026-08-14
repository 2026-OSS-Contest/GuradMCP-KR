package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.DemoSeed
import kr.guardmcp.controlplane.domain.LiveReplaySource
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.springframework.boot.test.context.SpringBootTest
import java.time.Instant
import java.util.UUID

/**
 * The wiring GMCP-114 exists for: an event ingested through `POST /api/v1/events` has to
 * show up on the Replay screen's endpoints. Before this, the ingest wrote to `guard_event`
 * and Replay read a seeded in-memory store, so a real demo run landed in the database and
 * appeared nowhere.
 *
 * This is an API test rather than a unit test on purpose — the point is the two halves
 * meeting, and only the running application wires them together.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ReplayLiveEventsApiTest : ApiTestSupport() {

    private fun ingest(
        sessionId: String,
        eventId: UUID = UUID.randomUUID(),
        verdict: String = "block",
        toolName: String = "read_file",
        direction: String = "request",
        riskScore: Int = 38,
        policyIds: List<String> = listOf("block_env_file_read"),
        detections: List<Map<String, Any?>> = emptyList(),
        ts: Instant = Instant.parse("2026-08-11T00:00:00Z"),
    ): UUID {
        val response = send(
            "POST", "/api/v1/events",
            mapOf(
                "eventId" to eventId.toString(),
                "sessionId" to sessionId,
                "ts" to ts.toString(),
                "direction" to direction,
                "toolName" to toolName,
                "argsDigest" to "324de04ab4c80caf",
                "verdict" to verdict,
                "riskScore" to riskScore,
                "matchedPolicyIds" to policyIds,
                "detections" to detections,
            ),
        )
        assertEquals(201, response.statusCode(), response.body())
        return eventId
    }

    @Test
    fun `an ingested block appears in the session list with its policy id and risk score`() {
        val sessionId = "s-live-${UUID.randomUUID()}"
        ingest(sessionId)

        val sessions = parseMap(get("/api/v1/sessions?limit=100").body())
        @Suppress("UNCHECKED_CAST")
        val items = sessions["items"] as List<Map<String, Any?>>
        val projected = items.firstOrNull { it["agentLabel"] == sessionId }
        assertNotNull(projected, "ingested session $sessionId is not listed: $items")

        assertEquals(1, projected!!["eventCount"])
        @Suppress("UNCHECKED_CAST")
        val verdicts = projected["verdictSummary"] as Map<String, Int>
        assertEquals(1, verdicts["block"])
        // The audit log is history, not an open session.
        assertEquals(false, projected["isLive"])
    }

    @Test
    fun `the timeline carries the deciding policy and risk score the gateway sent`() {
        val sessionId = "s-live-${UUID.randomUUID()}"
        val eventId = ingest(
            sessionId,
            detections = listOf(
                mapOf(
                    "type" to "SENSITIVE_FILE_PATH", "subtype" to "SENSITIVE_FILE_PATH",
                    "span" to mapOf("start" to 9, "end" to 13),
                    "confidence" to 0.6, "maskedAs" to "[PATH]",
                ),
            ),
        )

        val uuid = LiveReplaySource.sessionUuid(sessionId)
        val timeline = parseMap(get("/api/v1/sessions/$uuid/timeline").body())
        // Nothing stored a hash for these events, so no verification is claimed either way.
        assertEquals("unknown", timeline["chainStatus"])

        @Suppress("UNCHECKED_CAST")
        val nodes = timeline["nodes"] as List<Map<String, Any?>>
        assertEquals(1, nodes.size)
        val node = nodes[0]
        assertEquals(eventId.toString(), node["eventId"])
        assertEquals("VERDICT", node["type"])
        assertEquals("block", node["verdict"])
        assertEquals(38, node["riskScore"])
        assertEquals("read_file", node["toolName"])

        @Suppress("UNCHECKED_CAST")
        val detail = node["detail"] as Map<String, Any?>
        assertEquals(listOf("block_env_file_read"), detail["matchedPolicyIds"])

        // NFR-04: only the digest travels; the inspected arguments never do.
        assertTrue(timeline.toString().contains("324de04ab4c80caf"), "argsDigest should be present")
        assertTrue(!timeline.toString().contains(".env"), "raw path must not appear in the timeline")
    }

    @Test
    fun `an ingested event is addressable by its own id`() {
        val sessionId = "s-live-${UUID.randomUUID()}"
        val eventId = ingest(sessionId, verdict = "mask_then_allow", toolName = "search_tickets", direction = "response")

        val body = parseMap(get("/api/v1/events/$eventId").body())
        assertEquals(LiveReplaySource.sessionUuid(sessionId).toString(), body["sessionId"])
        assertEquals(eventId.toString(), body["eventId"])
        // Replay has four verdict badges; mask_then_allow shows as warn.
        assertEquals("warn", body["verdict"])
        assertEquals("res", body["direction"])
    }

    @Test
    fun `multiple events in one session chain in timestamp order`() {
        val sessionId = "s-live-${UUID.randomUUID()}"
        val start = Instant.parse("2026-08-11T01:00:00Z")
        ingest(sessionId, verdict = "warn", ts = start)
        ingest(sessionId, verdict = "block", ts = start.plusMillis(40))

        val uuid = LiveReplaySource.sessionUuid(sessionId)
        val timeline = parseMap(get("/api/v1/sessions/$uuid/timeline").body())
        // Nothing stored a hash for these events, so no verification is claimed either way.
        assertEquals("unknown", timeline["chainStatus"])
        @Suppress("UNCHECKED_CAST")
        val nodes = timeline["nodes"] as List<Map<String, Any?>>
        assertEquals(listOf("warn", "block"), nodes.map { it["verdict"] })
    }

    @Test
    fun `seeded demo sessions still resolve alongside projected ones`() {
        val sessionId = "s-live-${UUID.randomUUID()}"
        ingest(sessionId)

        // Decision on this ticket was to add live sessions, not replace the seeds: the
        // broken-chain fixture cannot be produced by running anything.
        val seeded = parseMap(get("/api/v1/sessions/${DemoSeed.SESSION_BROKEN_CHAIN_ID}/timeline").body())
        assertEquals("broken", seeded["chainStatus"])
        assertNotNull(seeded["brokenAt"])

        val sessions = parseMap(get("/api/v1/sessions?limit=100").body())
        @Suppress("UNCHECKED_CAST")
        val labels = (sessions["items"] as List<Map<String, Any?>>).map { it["sessionId"] }
        assertTrue(labels.contains(DemoSeed.SESSION_BROKEN_CHAIN_ID.toString()), "seeded session disappeared")
        assertTrue(labels.contains(LiveReplaySource.sessionUuid(sessionId).toString()), "projected session missing")
    }

    /**
     * The reason projected sessions report `unknown` rather than `valid`. Two events with
     * different content produce different hashes, and a recompute-then-self-compare check
     * calls both chains VALID — so a VALID here would say nothing about whether the rows
     * are the ones the gateway wrote. Until GMCP-83 stores a hash to check against, no
     * ingested content may produce a verification claim.
     */
    @Test
    fun `no ingested content can make a projected session claim a verified chain`() {
        val untampered = "s-live-${UUID.randomUUID()}"
        ingest(untampered, verdict = "block", riskScore = 38)

        val altered = "s-live-${UUID.randomUUID()}"
        ingest(altered, verdict = "allow", riskScore = 3, policyIds = emptyList())

        for (sessionId in listOf(untampered, altered)) {
            val uuid = LiveReplaySource.sessionUuid(sessionId)
            val timeline = parseMap(get("/api/v1/sessions/$uuid/timeline").body())
            assertEquals("unknown", timeline["chainStatus"], "projected session $sessionId claimed a chain verdict")
            assertNull(timeline["brokenAt"])
        }
    }

    @Test
    fun `a session that was never ingested is still not found`() {
        val response = get("/api/v1/sessions/${UUID.randomUUID()}/timeline")
        assertEquals(404, response.statusCode())
    }
}
