package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.AuditLogStore
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest

/**
 * GMCP-68 §5.1/§7.2/§7.3 DoD: `GET`/`PUT /api/v1/settings`, the `riskAcknowledged` server-side
 * guard (REQ-08), the fail_open -> fail_closed no-friction reversal (REQ-09), and the
 * `SETTINGS_FAILURE_POLICY_CHANGED` audit trail (§3.3).
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

    @AfterEach
    fun restoreFailClosed() {
        send("PUT", "/api/v1/settings", mapOf("failMode" to "fail_closed"))
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
    fun `switching to fail_open without riskAcknowledged is rejected (REQ-08)`() {
        val response = send("PUT", "/api/v1/settings", mapOf("failMode" to "fail_open"))

        assertEquals(400, response.statusCode())
        assertEquals("risk_not_acknowledged", parseMap(response.body())["code"])
    }

    @Test
    fun `switching to fail_open without riskAcknowledged does not change the stored value`() {
        send("PUT", "/api/v1/settings", mapOf("failMode" to "fail_open"))

        assertEquals("fail_closed", parseMap(get("/api/v1/settings").body())["failMode"])
    }

    @Test
    fun `switching to fail_open with riskAcknowledged=true is accepted and persisted`() {
        val response = send("PUT", "/api/v1/settings", mapOf("failMode" to "fail_open", "riskAcknowledged" to true))

        assertEquals(200, response.statusCode())
        val body = parseMap(response.body())
        assertEquals("fail_open", body["failMode"])
        assertEquals(true, body["riskAcknowledged"])
        assertEquals("fail_open", parseMap(get("/api/v1/settings").body())["failMode"])
    }

    @Test
    fun `reverting to fail_closed needs no acknowledgement (REQ-09)`() {
        send("PUT", "/api/v1/settings", mapOf("failMode" to "fail_open", "riskAcknowledged" to true))

        val response = send("PUT", "/api/v1/settings", mapOf("failMode" to "fail_closed"))

        assertEquals(200, response.statusCode())
        assertEquals("fail_closed", parseMap(response.body())["failMode"])
    }

    @Test
    fun `an unrecognized failMode value is rejected with the standardized error`() {
        val response = send("PUT", "/api/v1/settings", mapOf("failMode" to "sometimes"))

        assertEquals(400, response.statusCode())
        assertEquals("invalid_fail_mode", parseMap(response.body())["code"])
    }

    @Test
    fun `a field-only update (no failMode) never asks for acknowledgement`() {
        val response = send("PUT", "/api/v1/settings", mapOf("approvalTimeoutSeconds" to 300))

        assertEquals(200, response.statusCode())
        assertEquals(300, parseMap(response.body())["approvalTimeoutSeconds"])
    }

    @Test
    fun `fail_open activation is recorded in the audit log at severity=high`() {
        send("PUT", "/api/v1/settings", mapOf("failMode" to "fail_open", "riskAcknowledged" to true))

        val entries = auditLog.findByAction("SETTINGS_FAILURE_POLICY_CHANGED")
        val latest = entries.first()
        assertEquals("high", latest.severity)
        assertEquals("fail_open", latest.after["failurePolicy"])
        assertEquals(true, latest.after["riskAcknowledged"])
    }

    @Test
    fun `reverting to fail_closed is also audited, but at info severity`() {
        send("PUT", "/api/v1/settings", mapOf("failMode" to "fail_open", "riskAcknowledged" to true))
        send("PUT", "/api/v1/settings", mapOf("failMode" to "fail_closed"))

        val latest = auditLog.findByAction("SETTINGS_FAILURE_POLICY_CHANGED").first()
        assertEquals("info", latest.severity)
        assertEquals("fail_closed", latest.after["failurePolicy"])
    }

    @Test
    fun `a field-only update that doesn't touch failMode is not audited as a policy change`() {
        val before = auditLog.findByAction("SETTINGS_FAILURE_POLICY_CHANGED").size

        send("PUT", "/api/v1/settings", mapOf("locale" to "en"))

        assertEquals(before, auditLog.findByAction("SETTINGS_FAILURE_POLICY_CHANGED").size)
    }

    @Test
    fun `the settings stream pushes a snapshot on connect and again on every failMode change`() {
        openStream("/api/v1/settings/stream").use { stream ->
            val initial = nextEventData(stream.reader)
            assertTrue(initial.contains("\"failMode\":\"fail_closed\""))

            send("PUT", "/api/v1/settings", mapOf("failMode" to "fail_open", "riskAcknowledged" to true))
            val pushed = nextEventData(stream.reader)
            assertTrue(pushed.contains("\"failMode\":\"fail_open\""))
        }
    }
}
