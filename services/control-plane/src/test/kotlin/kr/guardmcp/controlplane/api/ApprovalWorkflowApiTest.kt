package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.ApprovalWorkflowService
import kr.guardmcp.controlplane.domain.DemoSeed
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * FR-APR three-path integration: approve, approve_masked, and the fail-closed timeout.
 * The approval timeout is shortened so the sweep is observable within the test budget.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = [
        "guardmcp.approval.timeout=PT1.5S",
        "guardmcp.approval.sweep-interval=PT0.1S",
    ],
)
class ApprovalWorkflowApiTest : ApiTestSupport() {
    @Autowired
    private lateinit var workflow: ApprovalWorkflowService

    private fun createApproval(): Map<String, Any?> {
        val created = send("POST",
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
        return parseMap(created.body())
    }

    @Test
    fun `approve path resolves the card and releases the awaiting gateway call`() {
        val card = createApproval()
        val id = card["id"] as String
        assertTrue(workflow.pendingQueueIds().map(UUID::toString).contains(id))

        val awaiting = client.sendAsync(
            HttpRequest.newBuilder(uri("/api/v1/approvals/$id/await?timeoutMs=10000")).GET().build(),
            HttpResponse.BodyHandlers.ofString(),
        )

        val decided = send("POST","/api/v1/approvals/$id/decision", mapOf("decision" to "approve", "decidedBy" to "reviewer"))
        assertEquals(200, decided.statusCode())

        val released = parseMap(awaiting.get(10, TimeUnit.SECONDS).body())
        assertEquals("approved", released["status"])
        assertEquals("reviewer", released["decidedBy"])
        assertTrue(workflow.pendingQueueIds().map(UUID::toString).none { it == id })
    }

    @Test
    fun `approve_masked path keeps the card payload and rejects a second decision`() {
        val card = createApproval()
        assertEquals("send_email", card["toolName"])
        assertEquals(mapOf("to" to "partner@external.example"), card["arguments"])
        assertEquals("External email delivery requires human approval", card["riskReason"])
        assertEquals("approve_external_email", card["policyId"])
        val id = card["id"] as String

        val decided = send("POST","/api/v1/approvals/$id/decision", mapOf("decision" to "approve_masked"))
        assertEquals(200, decided.statusCode())
        assertEquals("approved_masked", parseMap(decided.body())["status"])

        val duplicate = send("POST","/api/v1/approvals/$id/decision", mapOf("decision" to "block"))
        assertEquals(409, duplicate.statusCode())
        assertEquals("approval_already_decided", parseMap(duplicate.body())["code"])
    }

    @Test
    fun `timeout path fails closed with a system block and audit fields`() {
        val id = createApproval()["id"] as String

        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        var current: Map<String, Any?> = emptyMap()
        while (System.nanoTime() < deadline) {
            current = parseMap(get("/api/v1/approvals/$id").body())
            if (current["status"] == "expired") break
            Thread.sleep(100)
        }

        assertEquals("expired", current["status"], "approval did not expire within 10s")
        assertEquals("block", current["decision"])
        assertEquals("system:timeout", current["decidedBy"])
        assertTrue(current["decidedAt"] != null)

        val late = send("POST","/api/v1/approvals/$id/decision", mapOf("decision" to "approve"))
        assertEquals(409, late.statusCode())
        assertEquals("expired", (parseMap(late.body())["details"] as Map<*, *>)["status"])
    }

    @Test
    fun `awaiting an unknown approval returns the standardized 404`() {
        val response = get("/api/v1/approvals/${UUID.randomUUID()}/await?timeoutMs=100")
        assertEquals(404, response.statusCode())
        assertEquals("approval_not_found", parseMap(response.body())["code"])
    }
}
