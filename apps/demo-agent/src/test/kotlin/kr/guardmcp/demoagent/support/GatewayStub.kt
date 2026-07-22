package kr.guardmcp.demoagent.support

import com.sun.net.httpserver.HttpServer
import tools.jackson.module.kotlin.jacksonObjectMapper
import java.net.InetSocketAddress

/**
 * Minimal stand-in for the gateway's `POST /mcp` JSON-RPC surface, so the guarded path
 * can be exercised end to end without a running gateway. It reproduces the two responses
 * the demo relies on: a block for `read_file(.env)` and a mask for `customer_lookup`.
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
            val body = when (tool) {
                "read_file" -> blockResponse(id)
                "customer_lookup" -> maskResponse(id)
                else -> allowResponse(id)
            }.toByteArray()
            exchange.responseHeaders.add("content-type", "application/json")
            exchange.sendResponseHeaders(200, body.size.toLong())
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
}
