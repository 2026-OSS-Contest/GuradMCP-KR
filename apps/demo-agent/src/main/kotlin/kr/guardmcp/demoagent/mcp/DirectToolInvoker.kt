package kr.guardmcp.demoagent.mcp

import dev.langchain4j.agent.tool.ToolExecutionRequest
import kr.guardmcp.demoagent.config.DemoAgentProperties
import org.springframework.stereotype.Component
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration

/**
 * Vulnerable path: calls the sandboxed MCP tool servers **directly**, skipping the
 * gateway entirely, so the SCR-201 split shows the attack actually succeeding rather
 * than a scripted retelling of it. Nothing here inspects, masks, or blocks — that is
 * the point: the only difference from [GatewayToolInvoker] is the endpoint URL
 * (proposal 4.3), which is what makes "swap the endpoint, change no agent code" a
 * demonstrated property instead of a claim.
 *
 * Isolation comes from the tool server, not from this class: `read_file` is confined
 * to the sandbox fixture root and its `.env` holds synthetic non-routable values, and
 * `send_email` writes to a local outbox and never contacts a real SMTP server
 * (proposal 15 risk control, SCR-201 sandbox notice).
 */
@Component
class DirectToolInvoker(
    private val properties: DemoAgentProperties,
    private val objectMapper: ObjectMapper,
    private val httpClient: HttpClient,
) : ToolInvoker {

    override val mode = DemoMode.VULNERABLE

    override fun call(request: ToolExecutionRequest, sessionId: String): McpCallResult {
        val response = try {
            post(request.name(), request.arguments())
        } catch (error: Exception) {
            return failed(request.name(), "데모 MCP 도구에 연결할 수 없습니다: ${error.message}")
        }
        // An unguarded agent has no verdict to consult: whatever the tool returns is
        // simply used. A tool-level error still stops this step, but nothing was blocked.
        if (response.statusCode() !in 200..299) {
            return failed(request.name(), "데모 MCP 도구가 HTTP ${response.statusCode()}를 반환했습니다")
        }
        val result: JsonNode = objectMapper.readTree(response.body())
        return McpCallResult(
            tool = request.name(),
            mode = mode,
            source = "demo-mcp-tools",
            verdict = "executed",
            blocked = false,
            riskScore = 0,
            policyIds = emptyList(),
            detections = emptyList(),
            resultJson = objectMapper.writeValueAsString(result),
            message = "검사 없이 그대로 실행되었습니다 (미적용)",
            rpcCode = null,
        )
    }

    private fun post(name: String, arguments: String?): HttpResponse<String> {
        val encoded = URLEncoder.encode(name, StandardCharsets.UTF_8)
        val body = if (arguments.isNullOrBlank()) "{}" else arguments
        return httpClient.send(
            HttpRequest.newBuilder(URI.create("${properties.demoMcpToolsUrl}/tools/call/$encoded"))
                .timeout(Duration.ofSeconds(5))
                .header("content-type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build(),
            HttpResponse.BodyHandlers.ofString(),
        )
    }

    /**
     * `blocked = false` even on failure: the unguarded path never blocks, so reporting a
     * transport error as a block would credit the vulnerable side with protection it
     * does not have and make the before/after comparison misleading.
     */
    private fun failed(tool: String, message: String): McpCallResult = McpCallResult(
        tool = tool,
        mode = mode,
        source = "demo-mcp-tools",
        verdict = "error",
        blocked = false,
        riskScore = 0,
        policyIds = emptyList(),
        detections = emptyList(),
        resultJson = null,
        message = message,
        rpcCode = null,
    )
}
