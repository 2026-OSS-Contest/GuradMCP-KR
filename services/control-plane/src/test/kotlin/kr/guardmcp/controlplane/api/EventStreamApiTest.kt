package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.DemoSeed
import kr.guardmcp.controlplane.domain.EventStreamHub
import kr.guardmcp.controlplane.domain.GuardAction
import kr.guardmcp.controlplane.domain.GuardEvent
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Instant
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class EventStreamApiTest : ApiTestSupport() {
    @Autowired
    private lateinit var hub: EventStreamHub

    private val connections = mutableListOf<SseConnection>()

    /** Minimal SSE reader: collects (event name, data json) pairs from the stream. */
    private inner class SseConnection {
        private val events = LinkedBlockingQueue<Pair<String, String>>()
        private val response = client.sendAsync(
            HttpRequest.newBuilder(uri("/api/v1/events/stream")).GET().build(),
            HttpResponse.BodyHandlers.ofLines(),
        ).get(10, TimeUnit.SECONDS)

        private val reader = Thread.ofVirtual().start {
            var name: String? = null
            var data = StringBuilder()
            runCatching {
                response.body().forEach { line ->
                    when {
                        line.startsWith("event:") -> name = line.removePrefix("event:").trim()
                        line.startsWith("data:") -> data.append(line.removePrefix("data:").trim())
                        line.isBlank() -> {
                            val currentName = name
                            if (currentName != null) events.add(currentName to data.toString())
                            name = null
                            data = StringBuilder()
                        }
                    }
                }
            }
        }

        init {
            assertEquals(200, response.statusCode())
        }

        fun await(eventName: String): Map<String, Any?> {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
            while (System.nanoTime() < deadline) {
                val event = events.poll(100, TimeUnit.MILLISECONDS) ?: continue
                if (event.first == eventName) return parseMap(event.second)
            }
            throw AssertionError("no '$eventName' event arrived within 10s")
        }

        fun close() {
            runCatching { response.body().close() }
            reader.interrupt()
        }
    }

    private fun connect(): SseConnection = SseConnection().also(connections::add)

    @AfterEach
    fun tearDown() {
        connections.forEach(SseConnection::close)
        connections.clear()
    }

    @Test
    fun `connecting yields an initial gateway health snapshot`() {
        val health = connect().await(EventStreamHub.TYPE_GATEWAY_HEALTH)

        assertEquals("up", health["status"])
        assertNotNull(health["dependencies"])
    }

    @Test
    fun `policy pack updates reach every subscriber as policy reloaded`() {
        val first = connect()
        val second = connect()

        assertEquals(200, send("PUT", "/api/v1/policy-packs/korean-pii", mapOf("enabled" to false)).statusCode())
        assertEquals("korean-pii", first.await(EventStreamHub.TYPE_POLICY_RELOADED)["packId"])
        assertEquals("korean-pii", second.await(EventStreamHub.TYPE_POLICY_RELOADED)["packId"])

        assertEquals(200, send("PUT", "/api/v1/policy-packs/korean-pii", mapOf("enabled" to true)).statusCode())
        assertEquals(true, first.await(EventStreamHub.TYPE_POLICY_RELOADED)["enabled"])
    }

    @Test
    fun `approval creation and decision stream as approval events`() {
        val connection = connect()

        val created = send(
            "POST",
            "/api/v1/approvals",
            mapOf(
                "sessionId" to DemoSeed.SESSION_PII_ID.toString(),
                "toolName" to "send_email",
                "riskReason" to "External email delivery requires human approval",
            ),
        )
        assertEquals(201, created.statusCode())
        val createdEvent = connection.await(EventStreamHub.TYPE_APPROVAL_CREATED)
        assertEquals("pending", createdEvent["status"])
        val id = createdEvent["id"] as String

        assertEquals(200, send("POST", "/api/v1/approvals/$id/decision", mapOf("decision" to "approve")).statusCode())
        assertEquals("approved", connection.await(EventStreamHub.TYPE_APPROVAL_RESOLVED)["status"])
    }

    @Test
    fun `guard events published through the hub reach stream subscribers`() {
        val connection = connect()

        hub.publishGuardEvent(
            GuardEvent(
                id = UUID.randomUUID(),
                sessionId = DemoSeed.SESSION_INJECTION_ID,
                sequenceNo = 99,
                verdict = GuardAction.BLOCK,
                toolName = "read_file",
                policyId = "block_env_file_read",
                riskScore = 91,
                occurredAt = Instant.parse("2026-01-02T00:00:00Z"),
            ),
        )

        val event = connection.await(EventStreamHub.TYPE_GUARD_EVENT)
        assertEquals("block", event["verdict"])
        assertEquals("read_file", event["toolName"])
    }
}
