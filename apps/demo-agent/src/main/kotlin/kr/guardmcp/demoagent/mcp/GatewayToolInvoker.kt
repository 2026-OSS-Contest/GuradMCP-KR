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
                // A `require_approval` verdict can now genuinely hold the gateway's response
                // open for its full `approval.timeout_seconds` (120s, §5.1 GMCP-26) before
                // failing closed — e.g. T-01's malicious-README scenario sends the sandboxed
                // .env's secret to an external address via send_email, which matches
                // `approve_external_email_with_secret`. 5s used to be enough only because
                // require_approval had nothing to wait on and auto-expired instantly; it does
                // not anymore.
                .timeout(Duration.ofSeconds(130))
                .header("content-type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                .build(),
            HttpResponse.BodyHandlers.ofString(),
        )
        // A security gateway must fail closed: any non-2xx status means the verdict is
        // unknown, so we reject rather than read a body that may not carry a verdict.
        // The gateway returns HTTP 200 even for blocks (JSON-RPC error inside the body).
        if (response.statusCode() !in 200..299) {
            throw IllegalStateException("gateway returned HTTP ${response.statusCode()}")
        }
        return objectMapper.readTree(response.body())
    }

    private fun parseArguments(raw: String?): JsonNode =
        if (raw.isNullOrBlank()) objectMapper.createObjectNode() else objectMapper.readTree(raw)

    private fun parseVerdict(tool: String, node: JsonNode): McpCallResult {
        val error = node.get("error")
        if (error != null && !error.isNull) {
            // FR-GW-05 §3.1: the standardized block payload lives at error.data.guardmcp, with
            // one deciding `policyId` plus any other matched policies in `matchedPolicyIds`
            // (§3.2 — that list excludes `policyId` itself). A JSON-RPC error always means
            // nothing executed upstream, so this is unconditionally treated as blocked.
            val guardmcp = error.get("data")?.get("guardmcp")
            val policyId = guardmcp?.get("policyId")?.asString()
            return McpCallResult(
                tool = tool, mode = mode, source = "gateway",
                verdict = "block",
                blocked = true,
                riskScore = guardmcp?.get("riskScore")?.asInt() ?: 0,
                policyIds = listOfNotNull(policyId) + stringList(guardmcp?.get("matchedPolicyIds")),
                detections = detectionTags(guardmcp?.get("detectionSummary")),
                resultJson = null,
                // The human-readable reason lives on guardmcp.message; error.message is now the
                // fixed literal "GuardMCP-KR policy violation" shared by every block cause.
                message = guardmcp?.get("message")?.asString() ?: error.get("message")?.asString(),
                rpcCode = error.get("code")?.asInt(),
            )
        }

        // Success branch: only a recognized verdict from a present _guardmcp block may pass.
        // A missing block or an unknown verdict is a broken contract → fail closed.
        val guard = node.get("_guardmcp")
        val verdict = guard?.get("verdict")?.asString()
        if (guard == null || guard.isNull || verdict == null || verdict !in KNOWN_VERDICTS) {
            return McpCallResult(
                tool = tool, mode = mode, source = "gateway", verdict = "error",
                blocked = true, riskScore = 0, policyIds = emptyList(), detections = emptyList(),
                resultJson = null,
                message = "게이트웨이 응답에 유효한 _guardmcp.verdict가 없어 fail-closed로 차단했습니다.",
                rpcCode = null,
            )
        }
        val result = node.get("result")
        return McpCallResult(
            tool = tool, mode = mode, source = "gateway",
            verdict = verdict,
            blocked = verdict == "block" || verdict == "require_approval",
            riskScore = guard.get("riskScore")?.asInt() ?: 0,
            policyIds = stringList(guard.get("policyIds")),
            detections = detectionTags(guard.get("detections")),
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

    private companion object {
        /** The five DSL v1 verdicts the gateway may return; anything else is rejected. */
        val KNOWN_VERDICTS = setOf("allow", "warn", "mask_then_allow", "require_approval", "block")
    }
}
