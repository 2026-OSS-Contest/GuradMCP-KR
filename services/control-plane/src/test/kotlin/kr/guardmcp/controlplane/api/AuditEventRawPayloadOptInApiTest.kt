package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.GuardEventRepository
import kr.guardmcp.controlplane.domain.RevealAuditAction
import kr.guardmcp.controlplane.domain.RevealAuditLog
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.TestPropertySource
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Instant
import java.util.UUID

/**
 * Separate Spring context from [AuditEventApiTest] specifically to flip
 * `audit.store-raw-payload=true` (DoD: "true일 때만 저장되는 opt-in 동작 확인") — the property is
 * read once per app instance, not per request, so this can't be exercised in the same context
 * as the default-false tests.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = ["audit.store-raw-payload=true"])
class AuditEventRawPayloadOptInApiTest : ApiTestSupport() {
    @Autowired
    private lateinit var repository: GuardEventRepository

    @Autowired
    private lateinit var revealAuditLog: RevealAuditLog

    @Test
    fun `an operator can reveal the original payload, and exactly one audit log entry is written`() {
        val eventId = UUID.randomUUID()
        send(
            "POST", "/api/v1/events",
            mapOf(
                "eventId" to eventId.toString(),
                "sessionId" to UUID.randomUUID().toString(),
                "ts" to Instant.now().toString(),
                "direction" to "response",
                "toolName" to "read_file",
                "argsDigest" to "sha256:abc123",
                "verdict" to "block",
                "riskScore" to 87,
                "matchedPolicyIds" to listOf("block_env_file_read"),
                "detections" to emptyList<Any>(),
                "rawPayload" to "010-1234-5678 unmasked",
            ),
        )

        val response = client.send(
            HttpRequest.newBuilder(uri("/api/v1/events/$eventId/reveal"))
                .header("Content-Type", "application/json")
                .header(Actor.ID_HEADER, "operator@company.co.kr")
                .header(Actor.ROLE_HEADER, "operator")
                .POST(HttpRequest.BodyPublishers.ofString("""{"reason":"감사 대응용 확인"}"""))
                .build(),
            HttpResponse.BodyHandlers.ofString(),
        )

        assertEquals(200, response.statusCode())
        val body = parseMap(response.body())
        assertEquals("010-1234-5678 unmasked", body["originalPayload"])
        assertEquals("operator@company.co.kr", body["revealedBy"])
        assertNotNull(body["auditLogId"])

        val entries = revealAuditLog.all().filter { it.eventId == eventId }
        assertEquals(1, entries.size)
        assertEquals(RevealAuditAction.REVEAL, entries.single().action)
        assertEquals("감사 대응용 확인", entries.single().reason)
    }

    @Test
    fun `raw payload is persisted once this service explicitly opts in`() {
        val eventId = UUID.randomUUID()
        val response = send(
            "POST",
            "/api/v1/events",
            mapOf(
                "eventId" to eventId.toString(),
                "sessionId" to UUID.randomUUID().toString(),
                "ts" to Instant.now().toString(),
                "direction" to "response",
                "toolName" to "read_file",
                "argsDigest" to "sha256:abc123",
                "verdict" to "block",
                "riskScore" to 87,
                "matchedPolicyIds" to listOf("block_env_file_read"),
                "detections" to emptyList<Any>(),
                "rawPayload" to "010-1234-5678 unmasked",
            ),
        )

        assertEquals(201, response.statusCode())
        assertEquals("010-1234-5678 unmasked", repository.findById(eventId)?.rawPayload)
    }
}
