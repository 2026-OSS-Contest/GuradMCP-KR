package kr.guardmcp.demoagent.mcp

import dev.langchain4j.agent.tool.ToolExecutionRequest
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import tools.jackson.databind.node.ObjectNode
import kr.guardmcp.demoagent.config.DemoAgentProperties
import org.springframework.stereotype.Component
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

/**
 * Guarded path: forwards each tool call to the GuardMCP-KR gateway as MCP JSON-RPC
 * (`POST /mcp`, method `tools/call`) and reads the verdict straight out of the
 * gateway's own response. No detection logic lives here — the gateway is the
 * authority, so the demo shows the real product deciding.
 */
@Component
class GatewayToolInvoker(
    private val properties: DemoAgentProperties,
    private val objectMapper: ObjectMapper,
    private val httpClient: HttpClient,
) : ToolInvoker {

    override val mode = DemoMode.GUARDED

    override fun call(request: ToolExecutionRequest, sessionId: String): McpCallResult {
        val node = try {
            rawToolsCall(request.name(), parseArguments(request.arguments()), sessionId)
        } catch (error: Exception) {
            return McpCallResult(
                tool = request.name(), mode = mode, source = "gateway", verdict = "error",
                blocked = true, riskScore = 0, policyIds = emptyList(), detections = emptyList(),
                resultJson = null, message = "게이트웨이에 연결할 수 없습니다: ${error.message}", rpcCode = null,
            )
        }
        return parseVerdict(request.name(), node)
    }

    /** Sends `tools/call` and returns the gateway's raw JSON-RPC response node. */
    fun rawToolsCall(name: String, arguments: JsonNode, sessionId: String): JsonNode {
        val body: ObjectNode = objectMapper.createObjectNode().apply {
            put("jsonrpc", "2.0")
            put("id", sessionId)
            put("method", "tools/call")
            set("params", objectMapper.createObjectNode().apply {
                put("name", name)
                set("arguments", arguments)
            })
        }
        val response = httpClient.send(
            HttpRequest.newBuilder(URI.create("${properties.gatewayUrl}/mcp"))
                .timeout(Duration.ofSeconds(5))
                .header("content-type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                .build(),
            HttpResponse.BodyHandlers.ofString(),
        )
        return objectMapper.readTree(response.body())
    }

    private fun parseArguments(raw: String?): JsonNode =
        if (raw.isNullOrBlank()) objectMapper.createObjectNode() else objectMapper.readTree(raw)

    private fun parseVerdict(tool: String, node: JsonNode): McpCallResult {
        val error = node.get("error")
        if (error != null && !error.isNull) {
            val data = error.get("data")
            val verdict = data?.get("verdict")?.asString() ?: "block"
            return McpCallResult(
                tool = tool, mode = mode, source = "gateway",
                verdict = verdict,
                blocked = verdict == "block" || verdict == "require_approval",
                riskScore = data?.get("riskScore")?.asInt() ?: 0,
                policyIds = stringList(data?.get("policyIds")),
                detections = detectionTags(data?.get("detections")),
                resultJson = null,
                message = error.get("message")?.asString(),
                rpcCode = error.get("code")?.asInt(),
            )
        }

        val guard = node.get("_guardmcp")
        val verdict = guard?.get("verdict")?.asString() ?: "allow"
        val result = node.get("result")
        return McpCallResult(
            tool = tool, mode = mode, source = "gateway",
            verdict = verdict,
            blocked = verdict == "block" || verdict == "require_approval",
            riskScore = guard?.get("riskScore")?.asInt() ?: 0,
            policyIds = stringList(guard?.get("policyIds")),
            detections = detectionTags(guard?.get("detections")),
            resultJson = result?.let { objectMapper.writeValueAsString(it) },
            message = null,
            rpcCode = null,
        )
    }

    private fun stringList(node: JsonNode?): List<String> =
        if (node != null && node.isArray) node.values().map { it.asString() } else emptyList()

    private fun detectionTags(node: JsonNode?): List<String> =
        if (node == null || !node.isArray) {
            emptyList()
        } else {
            node.values().mapNotNull { detection ->
                val type = detection.get("type")?.asString() ?: return@mapNotNull null
                val subtype = detection.get("subtype")?.asString()
                if (subtype.isNullOrBlank()) type else "$type.$subtype"
            }.distinct()
        }
}
