package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.GuardEventRepository
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AuditEventApiTest : ApiTestSupport() {
    @Autowired
    private lateinit var repository: GuardEventRepository

    @Test
    fun `every pipeline verdict persists with policy ids, detections, and risk score`() {
        // AUDIT-01/DoD: the spec table lists four verdicts, but the policy engine's real Action
        // type (and what the action router actually emits) has a fifth, mask_then_allow — see
        // V1__create_guard_event.sql's header comment.
        listOf("allow", "warn", "require_approval", "block", "mask_then_allow").forEach { verdict ->
            val eventId = UUID.randomUUID()
            val response = send("POST", "/api/v1/events", ingestPayload(eventId, verdict = verdict))
            assertEquals(201, response.statusCode(), "verdict=$verdict")

            val stored = repository.findById(eventId)
            assertNotNull(stored, "verdict=$verdict")
            assertEquals(verdict, stored!!.verdict)
            assertEquals(listOf("block_env_file_read"), stored.matchedPolicyIds)
            assertEquals(1, stored.detections.size)
            assertEquals(0, BigDecimal("87").compareTo(stored.riskScore))
            assertNull(stored.rawPayload)
        }
    }

    @Test
    fun `a re-delivered event id is accepted but reported as not newly stored`() {
        // ON CONFLICT DO NOTHING makes redelivery idempotent (see GuardEventRepository.insert),
        // but the response must reflect that the second call was a no-op, not a fresh write.
        val eventId = UUID.randomUUID()
        val first = send("POST", "/api/v1/events", ingestPayload(eventId))
        val second = send("POST", "/api/v1/events", ingestPayload(eventId))

        assertEquals(201, first.statusCode())
        assertEquals(true, parseMap(first.body())["stored"])
        assertEquals(201, second.statusCode())
        assertEquals(false, parseMap(second.body())["stored"])
    }

    @Test
    fun `session id is opaque text, not required to be a uuid`() {
        // Gateway falls back to `req-<uuid>` style session ids when the caller supplies none
        // (server.ts `sessionIdOf`); the column must accept that shape.
        val eventId = UUID.randomUUID()
        val sessionId = "req-${UUID.randomUUID()}"
        val response = send("POST", "/api/v1/events", ingestPayload(eventId, sessionId = sessionId))

        assertEquals(201, response.statusCode())
        assertEquals(sessionId, repository.findById(eventId)?.sessionId)
    }

    @Test
    fun `both request and response directions are accepted`() {
        val requestEventId = UUID.randomUUID()
        val responseEventId = UUID.randomUUID()
        send("POST", "/api/v1/events", ingestPayload(requestEventId, direction = "request"))
        send("POST", "/api/v1/events", ingestPayload(responseEventId, direction = "response"))

        assertEquals("request", repository.findById(requestEventId)?.direction)
        assertEquals("response", repository.findById(responseEventId)?.direction)
    }

    @Test
    fun `unknown verdict is rejected with the standardized error`() {
        val response = send("POST", "/api/v1/events", ingestPayload(UUID.randomUUID(), verdict = "bogus"))

        assertEquals(400, response.statusCode())
        assertEquals("invalid_verdict", parseMap(response.body())["code"])
    }

    @Test
    fun `unknown direction is rejected with the standardized error`() {
        val response = send("POST", "/api/v1/events", ingestPayload(UUID.randomUUID(), direction = "res"))

        assertEquals(400, response.statusCode())
        assertEquals("invalid_direction", parseMap(response.body())["code"])
    }

    @Test
    fun `raw payload is dropped by default even when the gateway sends one`() {
        // audit.store-raw-payload defaults to false (application.yaml) — NFR-04.
        val eventId = UUID.randomUUID()
        send("POST", "/api/v1/events", ingestPayload(eventId, rawPayload = "010-1234-5678 unmasked"))

        assertNull(repository.findById(eventId)?.rawPayload)
    }

    @Test
    fun `tolerates fields the gateway sends that this DTO doesn't declare`() {
        // The router (packages/gateway/src/pipeline/actionRouter.ts buildGuardEvent) sends
        // decidedBy/decidedAt on the approval-resolved path; GuardEventIngestRequest has no such
        // properties. This pins that Jackson's default unknown-property tolerance is what makes
        // that safe, matching the real payload shape exercised gateway-side by
        // auditPublisher.test.ts's "contract:" test.
        val eventId = UUID.randomUUID()
        val payload = ingestPayload(eventId) + mapOf(
            "decidedBy" to "approval-backend",
            "decidedAt" to Instant.now().toString(),
        )

        val response = send("POST", "/api/v1/events", payload)

        assertEquals(201, response.statusCode())
        assertNotNull(repository.findById(eventId))
    }

    private fun ingestPayload(
        eventId: UUID,
        sessionId: String = UUID.randomUUID().toString(),
        verdict: String = "block",
        direction: String = "response",
        rawPayload: String? = null,
    ) = mapOf(
        "eventId" to eventId.toString(),
        "sessionId" to sessionId,
        "ts" to Instant.now().toString(),
        "direction" to direction,
        "toolName" to "read_file",
        "argsDigest" to "sha256:abc123",
        "verdict" to verdict,
        "riskScore" to 87,
        "matchedPolicyIds" to listOf("block_env_file_read"),
        "detections" to listOf(
            mapOf(
                "type" to "SECRET",
                "subtype" to "ENV_FILE",
                "span" to mapOf("start" to 0, "end" to 5),
                "confidence" to 0.9,
                "maskedAs" to "[SECRET]",
            ),
        ),
        "maskDiffRef" to null,
        "rawPayload" to rawPayload,
    )
}
