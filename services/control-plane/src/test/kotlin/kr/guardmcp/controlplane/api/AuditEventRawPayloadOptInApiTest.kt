package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.GuardEventRepository
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.TestPropertySource
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
