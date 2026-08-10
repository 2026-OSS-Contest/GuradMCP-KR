package kr.guardmcp.demoagent.support

import com.sun.net.httpserver.HttpServer
import tools.jackson.module.kotlin.jacksonObjectMapper
import java.net.InetSocketAddress

/**
 * Minimal stand-in for the gateway's `POST /mcp` JSON-RPC surface, so the guarded path
 * can be exercised end to end without a running gateway. It reproduces the responses the
 * demo relies on — a block for `read_file(.env)`, a mask for `customer_lookup` — plus the
 * contract-breaking responses the client must fail closed on (missing `_guardmcp`, an
 * unknown verdict, and a non-2xx status).
 */
class GatewayStub {
    private val mapper = jacksonObjectMapper()
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)

    val baseUrl: String get() = "http://127.0.0.1:${server.address.port}"

    fun start(): GatewayStub {
        server.createContext("/mcp") { exchange ->
            val request = mapper.readTree(exchange.requestBody.readBytes())
            val id = request.path("id").asString("1")
            val tool = request.path("params").path("name").asString()
            val (status, payload) = when (tool) {
                "read_file" -> 200 to blockResponse(id)
                "customer_lookup" -> 200 to maskResponse(id)
                "search_tickets" -> 200 to consultationMaskResponse(id)
                "missing_guard" -> 200 to missingGuardResponse(id)
                "unknown_verdict" -> 200 to unknownVerdictResponse(id)
                "server_error" -> 500 to """{"error":"boom"}"""
                else -> 200 to allowResponse(id)
            }
            val body = payload.toByteArray()
            exchange.responseHeaders.add("content-type", "application/json")
            exchange.sendResponseHeaders(status, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.start()
        return this
    }

    fun stop() = server.stop(0)

    // FR-GW-05 shape: fixed code/message, real payload nested under data.guardmcp.
    private fun blockResponse(id: String) = """
        {"jsonrpc":"2.0","id":"$id","error":{"code":-32001,"message":"GuardMCP-KR policy violation",
        "data":{"guardmcp":{"schemaVersion":"1.0","eventId":"evt-test-block","policyId":"block_env_file_read",
        "reasonCode":"SECRET_FILE_ACCESS_BLOCKED","severity":"critical",
        "message":"Credential-file access was blocked by policy.","riskScore":0,
        "sessionId":"$id","timestamp":"2026-08-01T00:00:00.000Z"}}}}
    """.trimIndent()

    private fun maskResponse(id: String) = """
        {"jsonrpc":"2.0","id":"$id","result":{"content":[{"phone":"[PHONE]"}]},
        "_guardmcp":{"verdict":"mask_then_allow","riskScore":75,"policyIds":["mask_korean_pii_response"],
        "detections":[{"type":"PII","subtype":"PHONE"}],"masked":"[PHONE]"}}
    """.trimIndent()

    /**
     * GMCP-20: what the gateway returns for the consultation-log lookup once
     * `mask_korean_pii_response` has run — the ticket body with every personal-data span
     * replaced by its tag. Three Korean PII types in one body is the whole point of the
     * scenario, so all three tags appear here.
     */
    private fun consultationMaskResponse(id: String) = """
        {"jsonrpc":"2.0","id":"$id","result":{"content":[{"ticketId":"TCK-2026-9001",
        "body":"연락처는 [PHONE] 입니다. 주민등록번호 [RRN_LIKE] 확인했고, 환불 [BANK_ACCOUNT] 으로 안내했습니다. 회신 메일은 [EMAIL]."}]},
        "_guardmcp":{"verdict":"mask_then_allow","riskScore":75,"policyIds":["mask_korean_pii_response"],
        "detections":[{"type":"PII","subtype":"PHONE"},{"type":"PII","subtype":"RRN_LIKE"},
        {"type":"PII","subtype":"BANK_ACCOUNT"},{"type":"PII","subtype":"EMAIL"}],"masked":""}}
    """.trimIndent()

    private fun allowResponse(id: String) = """
        {"jsonrpc":"2.0","id":"$id","result":{"content":[]},
        "_guardmcp":{"verdict":"allow","riskScore":0,"policyIds":[],"detections":[],"masked":""}}
    """.trimIndent()

    /** 2xx JSON with a result but no `_guardmcp` block — a broken security contract. */
    private fun missingGuardResponse(id: String) = """
        {"jsonrpc":"2.0","id":"$id","result":{"content":[{"leak":"sk-should-not-pass"}]}}
    """.trimIndent()

    /** 2xx JSON whose verdict is outside the DSL v1 allowlist. */
    private fun unknownVerdictResponse(id: String) = """
        {"jsonrpc":"2.0","id":"$id","result":{"content":[]},
        "_guardmcp":{"verdict":"maybe","riskScore":0,"policyIds":[],"detections":[],"masked":""}}
    """.trimIndent()
}
