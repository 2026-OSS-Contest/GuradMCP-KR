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

    private fun blockResponse(id: String) = """
        {"jsonrpc":"2.0","id":"$id","error":{"code":-32001,"message":"GuardMCP blocked unsafe tool arguments",
        "data":{"verdict":"block","riskScore":0,"policyIds":["block_env_file_read"],"detections":[],"masked":""}}}
    """.trimIndent()

    private fun maskResponse(id: String) = """
        {"jsonrpc":"2.0","id":"$id","result":{"content":[{"phone":"[PHONE]"}]},
        "_guardmcp":{"verdict":"mask_then_allow","riskScore":75,"policyIds":["mask_korean_pii_response"],
        "detections":[{"type":"PII","subtype":"PHONE"}],"masked":"[PHONE]"}}
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
