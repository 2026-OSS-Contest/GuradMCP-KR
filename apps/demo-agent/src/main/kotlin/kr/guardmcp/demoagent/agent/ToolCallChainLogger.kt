package kr.guardmcp.demoagent.agent

import dev.langchain4j.agent.tool.ToolExecutionRequest
import tools.jackson.databind.ObjectMapper
import kr.guardmcp.demoagent.mcp.DemoMode
import kr.guardmcp.demoagent.mcp.McpCallResult
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component

/**
 * Structured (JSON) logging of the tool-call chain — FR-GW-01's "chain logging" and
 * NFR-06's structured logs. Deliberately records only the non-sensitive target
 * (path/recipient) and the verdict, never argument bodies, so a leaked secret can't
 * ride out through the logs (NFR-04).
 */
@Component
class ToolCallChainLogger(private val objectMapper: ObjectMapper) {

    private val log = LoggerFactory.getLogger("guardmcp.toolchain")

    fun log(sessionId: String, mode: DemoMode, step: Int, request: ToolExecutionRequest, result: McpCallResult) {
        val entry = linkedMapOf(
            "service" to "demo-agent",
            "event" to "tool_call",
            "sessionId" to sessionId,
            "mode" to mode.name.lowercase(),
            "step" to step,
            "tool" to request.name(),
            "target" to ToolArguments.target(objectMapper, request),
            "source" to result.source,
            "verdict" to result.verdict,
            "blocked" to result.blocked,
            "riskScore" to result.riskScore,
            "policyIds" to result.policyIds,
            "detections" to result.detections,
        )
        log.info(objectMapper.writeValueAsString(entry))
    }
}
