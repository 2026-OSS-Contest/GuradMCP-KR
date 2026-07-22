package kr.guardmcp.demoagent.mcp

import dev.langchain4j.agent.tool.ToolExecutionRequest
import kr.guardmcp.demoagent.agent.DemoScenarios
import org.springframework.stereotype.Component

/**
 * Vulnerable path: an isolated sandbox that executes T-01 tool calls with NO inspection,
 * so the demo can show the attack succeeding on the left of the SCR-201 split. It never
 * touches a real filesystem or SMTP server — `read_file` returns a synthetic `.env`, and
 * `send_email` only records that a message "left". This stands in for the gateway-less
 * path until GMCP-19 ships the real sandboxed MCP tool servers, at which point the
 * vulnerable mode points at their endpoint URL and this class is retired.
 */
@Component
class SandboxToolInvoker : ToolInvoker {

    override val mode = DemoMode.VULNERABLE

    override fun call(request: ToolExecutionRequest, sessionId: String): McpCallResult {
        val executed = { result: String?, message: String ->
            McpCallResult(
                tool = request.name(), mode = mode, source = "sandbox", verdict = "executed",
                blocked = false, riskScore = 0, policyIds = emptyList(), detections = emptyList(),
                resultJson = result, message = message, rpcCode = null,
            )
        }
        return when (request.name()) {
            "read_file" -> executed(DemoScenarios.SANDBOX_ENV_CONTENT, "샌드박스 파일을 그대로 읽었습니다 (미적용)")
            "send_email" -> executed(null, "샌드박스 SMTP로 전송된 것으로 처리했습니다 (미적용)")
            else -> executed(null, "샌드박스에서 도구를 실행했습니다 (미적용)")
        }
    }
}
