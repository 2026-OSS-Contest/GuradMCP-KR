package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.GuardEventRepository
import kr.guardmcp.controlplane.domain.RevealAuditLog
import kr.guardmcp.controlplane.domain.RevealResult
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.TestPropertySource
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Instant
import java.util.UUID

/**
 * Separate Spring context from [AuditEventApiTest] specifically to flip `rawPayloadStorageEnabled`
 * on (DoD: "true일 때만 저장되는 opt-in 동작 확인", GMCP-84 §10.2). Unlike the old in-memory
 * `SettingsStore` this replaced, [kr.guardmcp.controlplane.domain.GuardSettingsStore]'s
 * `guard_settings` row is a single Postgres singleton shared by every Spring context in this JVM
 * fork (see [ApiTestSupport]'s shared-container note) — [enableRawPayloadOptIn]/
 * [restoreRawPayloadOptOut] turn it on for each test and back off afterward so it never leaks
 * into [AuditEventApiTest]'s "off by default" assumptions.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(
    properties = [
        "security.reveal-token=test-operator-token",
        "security.raw-payload-encryption-key=MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
    ],
)
class AuditEventRawPayloadOptInApiTest : ApiTestSupport() {
    @Autowired
    private lateinit var repository: GuardEventRepository

    @Autowired
    private lateinit var revealAuditLog: RevealAuditLog

    @BeforeEach
    fun enableRawPayloadOptIn() {
        send("PUT", "/api/v1/settings", mapOf("rawPayloadStorageEnabled" to true, "acknowledgedNotice" to true)) {
            it.header(Actor.ID_HEADER, "operator@company.co.kr")
                .header(Actor.ROLE_HEADER, "operator")
                .header(Actor.OPERATOR_TOKEN_HEADER, "test-operator-token")
        }
    }

    @AfterEach
    fun restoreRawPayloadOptOut() {
        send("PUT", "/api/v1/settings", mapOf("rawPayloadStorageEnabled" to false)) {
            it.header(Actor.ID_HEADER, "operator@company.co.kr")
                .header(Actor.ROLE_HEADER, "operator")
                .header(Actor.OPERATOR_TOKEN_HEADER, "test-operator-token")
        }
    }

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
                .header(Actor.OPERATOR_TOKEN_HEADER, "test-operator-token")
                .POST(HttpRequest.BodyPublishers.ofString("""{"reason":"감사 대응용 확인"}"""))
                .build(),
            HttpResponse.BodyHandlers.ofString(),
        )

        assertEquals(200, response.statusCode())
        val body = parseMap(response.body())
        assertEquals("010-1234-5678 unmasked", body["rawPayload"])
        assertEquals("operator@company.co.kr", body["revealedBy"])
        assertNotNull(body["revealedAt"])

        val entries = revealAuditLog.findByEventId(eventId)
        assertEquals(1, entries.size)
        assertEquals(RevealResult.SUCCESS, entries.single().result)
        assertEquals("감사 대응용 확인", entries.single().reason)
    }

    @Test
    fun `raw payload is persisted encrypted once this service explicitly opts in`() {
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
        // Only a raw_payload_ref lands on guard_event — the plaintext itself is never a column
        // on this row (GMCP-84 §5.1), and only reveal (via RawPayloadStore.decrypt) can recover it.
        assertNotNull(repository.findById(eventId)?.rawPayloadRef)
    }

    private fun send(method: String, path: String, body: Any?, headers: (HttpRequest.Builder) -> HttpRequest.Builder): HttpResponse<String> {
        val builder = headers(
            HttpRequest.newBuilder(uri(path))
                .header("Content-Type", "application/json")
                .method(method, HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body))),
        )
        return client.send(builder.build(), HttpResponse.BodyHandlers.ofString())
    }
}
