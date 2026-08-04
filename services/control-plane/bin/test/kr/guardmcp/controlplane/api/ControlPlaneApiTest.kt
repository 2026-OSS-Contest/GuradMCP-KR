package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.DemoSeed
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.SpringBootTest
import java.util.UUID

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ControlPlaneApiTest : ApiTestSupport() {
    @Test
    fun `overview exposes the protection summary contract`() {
        val response = get("/api/v1/overview")

        assertEquals(200, response.statusCode())
        val body = parseMap(response.body())
        assertEquals(true, body["protected"])
        assertEquals(listOf("default", "korean-pii"), body["activePolicyPacks"])
        assertEquals(1, body["gatewayCount"])
        assertNotNull(body["blockedToday"])
        assertNotNull(body["maskedToday"])
        assertNotNull(body["pendingApprovals"])
        assertNotNull(body["generatedAt"])
    }

    @Test
    fun `seeded session timeline lists its guard events`() {
        val response = get("/api/v1/sessions/${DemoSeed.SESSION_INJECTION_ID}/timeline")

        assertEquals(200, response.statusCode())
        val body = parseMap(response.body())
        assertEquals("T-01", body["scenarioId"])
        val events = body["events"] as List<*>
        assertEquals(1, events.size)
        val event = events.single() as Map<*, *>
        assertEquals("block", event["verdict"])
        assertEquals("read_file", event["toolName"])
        assertEquals("block_env_file_read", event["policyId"])
        assertEquals(96, event["riskScore"])
    }

    @Test
    fun `unknown session timeline returns the standardized 404 error`() {
        val response = get("/api/v1/sessions/${UUID.randomUUID()}/timeline")

        assertEquals(404, response.statusCode())
        assertEquals("session_not_found", parseMap(response.body())["code"])
    }

    @Test
    fun `policies and policy packs expose the seeded catalog`() {
        val policies = get("/api/v1/policies")
        val packs = get("/api/v1/policy-packs")

        assertEquals(200, policies.statusCode())
        assertEquals(3, parseList(policies.body()).size)
        assertEquals(200, packs.statusCode())
        assertEquals(2, parseList(packs.body()).size)
    }

    @Test
    fun `policy pack toggle round-trips and bumps the version`() {
        val disabled = send("PUT", "/api/v1/policy-packs/korean-pii", mapOf("enabled" to false))
        assertEquals(200, disabled.statusCode())
        assertEquals(false, parseMap(disabled.body())["enabled"])

        val overview = parseMap(get("/api/v1/overview").body())
        assertEquals(listOf("default"), overview["activePolicyPacks"])

        val enabled = send("PUT", "/api/v1/policy-packs/korean-pii", mapOf("enabled" to true))
        val enabledBody = parseMap(enabled.body())
        assertEquals(true, enabledBody["enabled"])
        assertTrue(enabledBody["version"] as Int >= 3)
    }

    @Test
    fun `approval lifecycle creates a card then rejects a duplicate decision`() {
        val created = send(
            "POST",
            "/api/v1/approvals",
            mapOf(
                "sessionId" to DemoSeed.SESSION_PII_ID.toString(),
                "toolName" to "send_email",
                "arguments" to mapOf("to" to "partner@external.example"),
                "riskReason" to "External email delivery requires human approval",
                "policyId" to "approve_external_email",
            ),
        )
        assertEquals(201, created.statusCode())
        val card = parseMap(created.body())
        assertEquals("pending", card["status"])
        assertEquals("send_email", card["toolName"])
        assertEquals("approve_external_email", card["policyId"])
        val id = card["id"] as String

        val decided = send("POST", "/api/v1/approvals/$id/decision", mapOf("decision" to "approve", "decidedBy" to "reviewer"))
        assertEquals(200, decided.statusCode())
        assertEquals("approved", parseMap(decided.body())["status"])

        val duplicate = send("POST", "/api/v1/approvals/$id/decision", mapOf("decision" to "block"))
        assertEquals(409, duplicate.statusCode())
        assertEquals("approval_already_decided", parseMap(duplicate.body())["code"])
    }

    @Test
    fun `detect preview masks the korean phone and blocks the env read`() {
        val response = send(
            "POST",
            "/api/v1/detect/preview",
            mapOf("text" to "고객 010-1234-5678 명단을 /workspace/.env 와 함께 보내줘"),
        )

        assertEquals(200, response.statusCode())
        val body = parseMap(response.body())
        assertEquals("block", body["verdict"])
        assertTrue((body["maskedText"] as String).contains("010-****-5678"))
        val policyIds = (body["findings"] as List<*>).map { (it as Map<*, *>)["policyId"] }
        assertTrue(policyIds.containsAll(listOf("block_env_file_read", "mask_korean_phone")))
    }

    @Test
    fun `attack lab run accepts known scenarios and rejects unknown ones`() {
        val accepted = send("POST", "/api/v1/attacklab/run/T-01", null)
        assertEquals(202, accepted.statusCode())
        val acceptedBody = parseMap(accepted.body())
        assertEquals("queued", acceptedBody["status"])
        assertEquals("T-01", acceptedBody["scenarioId"])

        val rejected = send("POST", "/api/v1/attacklab/run/T-99", null)
        assertEquals(404, rejected.statusCode())
        assertEquals("scenario_not_found", parseMap(rejected.body())["code"])
    }
}
