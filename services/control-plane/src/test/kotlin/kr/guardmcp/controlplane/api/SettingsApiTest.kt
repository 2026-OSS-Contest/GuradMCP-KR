package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.AuditLogStore
import kr.guardmcp.controlplane.domain.GuardEventRepository
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Instant
import java.util.UUID

/**
 * GMCP-68 §5.1/§7.2/§7.3 DoD (`GET`/`PUT`/`stream /api/v1/settings`, the `riskAcknowledged`
 * server-side guard (REQ-08), the fail_open -> fail_closed no-friction reversal (REQ-09), and the
 * `SETTINGS_FAILURE_POLICY_CHANGED`/`SETTINGS_RAW_PAYLOAD_OPT_IN_CHANGED` audit trail (§3.3))
 * plus GMCP-80 §3.8.2's operator-role gate on `PUT`, which GMCP-68 predates.
 *
 * `guard_settings` is a singleton row shared by every test in this class (and, via the shared
 * Postgres container from [ApiTestSupport], by every other test class in this JVM fork) — each
 * test that changes `failMode` restores it to `fail_closed` afterward so it never leaks state
 * into a test that runs after it, regardless of JUnit's (unspecified) method order.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SettingsApiTest : ApiTestSupport() {
    @Autowired
    private lateinit var auditLog: AuditLogStore

    @Autowired
    private lateinit var repository: GuardEventRepository

    @AfterEach
    fun restoreFailClosed() {
        putSettings(mapOf("failMode" to "fail_closed"), operator = true)
    }

    @Test
    fun `GET settings answers the shape SCR-501 already renders`() {
        val body = parseMap(get("/api/v1/settings").body())
        assertTrue(body.containsKey("failMode"))
        assertTrue(body.containsKey("riskAcknowledged"))
        assertTrue(body.containsKey("storeRawOptIn"))
        assertTrue(body.containsKey("locale"))
        assertTrue(body.containsKey("approvalTimeoutSeconds"))
    }

    @Test
    fun `updating settings without the operator role is forbidden`() {
        val response = putSettings(mapOf("approvalTimeoutSeconds" to 60), operator = false)

        assertEquals(403, response.statusCode())
        assertEquals("settings_update_forbidden", parseMap(response.body())["code"])
    }

    @Test
    fun `switching to fail_open without riskAcknowledged is rejected (REQ-08)`() {
        val response = putSettings(mapOf("failMode" to "fail_open"), operator = true)

        assertEquals(400, response.statusCode())
        assertEquals("risk_not_acknowledged", parseMap(response.body())["code"])
    }

    @Test
    fun `switching to fail_open without riskAcknowledged does not change the stored value`() {
        putSettings(mapOf("failMode" to "fail_open"), operator = true)

        assertEquals("fail_closed", parseMap(get("/api/v1/settings").body())["failMode"])
    }

    @Test
    fun `switching to fail_open with riskAcknowledged=true is accepted and persisted`() {
        val response = putSettings(mapOf("failMode" to "fail_open", "riskAcknowledged" to true), operator = true)

        assertEquals(200, response.statusCode())
        val body = parseMap(response.body())
        assertEquals("fail_open", body["failMode"])
        assertEquals(true, body["riskAcknowledged"])
        assertEquals("fail_open", parseMap(get("/api/v1/settings").body())["failMode"])
    }

    @Test
    fun `reverting to fail_closed needs no acknowledgement (REQ-09)`() {
        putSettings(mapOf("failMode" to "fail_open", "riskAcknowledged" to true), operator = true)

        val response = putSettings(mapOf("failMode" to "fail_closed"), operator = true)

        assertEquals(200, response.statusCode())
        assertEquals("fail_closed", parseMap(response.body())["failMode"])
    }

    @Test
    fun `a partial update changes only the given field`() {
        val response = putSettings(mapOf("approvalTimeoutSeconds" to 90), operator = true)

        assertEquals(200, response.statusCode())
        val body = parseMap(response.body())
        assertEquals(90, body["approvalTimeoutSeconds"])
        assertEquals("fail_closed", body["failMode"])
    }

    @Test
    fun `invalid enum values and an out-of-range timeout are rejected`() {
        val badFailMode = putSettings(mapOf("failMode" to "bogus"), operator = true)
        assertEquals(400, badFailMode.statusCode())
        assertEquals("invalid_fail_mode", parseMap(badFailMode.body())["code"])

        val badLocale = putSettings(mapOf("locale" to "jp"), operator = true)
        assertEquals(400, badLocale.statusCode())
        assertEquals("invalid_locale", parseMap(badLocale.body())["code"])

        val zeroTimeout = putSettings(mapOf("approvalTimeoutSeconds" to 0), operator = true)
        assertEquals(400, zeroTimeout.statusCode())
        assertEquals("invalid_approval_timeout", parseMap(zeroTimeout.body())["code"])

        val tooLongTimeout = putSettings(mapOf("approvalTimeoutSeconds" to 3601), operator = true)
        assertEquals(400, tooLongTimeout.statusCode())
        assertEquals("invalid_approval_timeout", parseMap(tooLongTimeout.body())["code"])
    }

    @Test
    fun `fail_open activation is recorded in the audit log at severity=high`() {
        putSettings(mapOf("failMode" to "fail_open", "riskAcknowledged" to true), operator = true)

        val latest = auditLog.findByAction("SETTINGS_FAILURE_POLICY_CHANGED").first()
        assertEquals("high", latest.severity)
        assertEquals("fail_open", latest.after["failurePolicy"])
        assertEquals(true, latest.after["riskAcknowledged"])
    }

    @Test
    fun `reverting to fail_closed is also audited, but at info severity`() {
        putSettings(mapOf("failMode" to "fail_open", "riskAcknowledged" to true), operator = true)
        putSettings(mapOf("failMode" to "fail_closed"), operator = true)

        val latest = auditLog.findByAction("SETTINGS_FAILURE_POLICY_CHANGED").first()
        assertEquals("info", latest.severity)
        assertEquals("fail_closed", latest.after["failurePolicy"])
    }

    @Test
    fun `a field-only update that doesn't touch failMode is not audited as a policy change`() {
        val before = auditLog.findByAction("SETTINGS_FAILURE_POLICY_CHANGED").size

        putSettings(mapOf("locale" to "en"), operator = true)

        assertEquals(before, auditLog.findByAction("SETTINGS_FAILURE_POLICY_CHANGED").size)
    }

    @Test
    fun `enabling raw payload opt-in is audited and takes effect on the next ingest without a restart`() {
        val beforeToggle = UUID.randomUUID()
        send("POST", "/api/v1/events", ingestPayload(beforeToggle, rawPayload = "before-toggle"))
        assertNull(repository.findById(beforeToggle)?.rawPayload)

        val before = auditLog.findByAction("SETTINGS_RAW_PAYLOAD_OPT_IN_CHANGED").size
        val response = putSettings(mapOf("storeRawOptIn" to true), operator = true)
        assertEquals(200, response.statusCode())
        assertEquals(before + 1, auditLog.findByAction("SETTINGS_RAW_PAYLOAD_OPT_IN_CHANGED").size)

        val afterToggle = UUID.randomUUID()
        send("POST", "/api/v1/events", ingestPayload(afterToggle, rawPayload = "after-toggle"))
        assertEquals("after-toggle", repository.findById(afterToggle)?.rawPayload)

        putSettings(mapOf("storeRawOptIn" to false), operator = true)
    }

    @Test
    fun `the settings stream pushes a snapshot on connect and again on every failMode change`() {
        openStream("/api/v1/settings/stream").use { stream ->
            val initial = nextEventData(stream.reader)
            assertTrue(initial.contains("\"failMode\":\"fail_closed\""))

            putSettings(mapOf("failMode" to "fail_open", "riskAcknowledged" to true), operator = true)
            val pushed = nextEventData(stream.reader)
            assertTrue(pushed.contains("\"failMode\":\"fail_open\""))
        }
    }

    private fun putSettings(fields: Map<String, Any?>, operator: Boolean): HttpResponse<String> {
        val builder = HttpRequest.newBuilder(uri("/api/v1/settings"))
            .header("Content-Type", "application/json")
            .PUT(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(fields)))
        if (operator) {
            builder.header(Actor.ID_HEADER, "operator@company.co.kr").header(Actor.ROLE_HEADER, "operator")
        }
        return client.send(builder.build(), HttpResponse.BodyHandlers.ofString())
    }

    private fun ingestPayload(eventId: UUID, rawPayload: String?) = mapOf(
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
        "rawPayload" to rawPayload,
    )
}
