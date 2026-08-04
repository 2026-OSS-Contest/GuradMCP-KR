package kr.guardmcp.demoagent.agent

import dev.langchain4j.agent.tool.ToolExecutionRequest
import tools.jackson.databind.ObjectMapper

/** Pulls the non-sensitive "target" out of a tool call for logging and UI display. */
object ToolArguments {
    fun target(objectMapper: ObjectMapper, request: ToolExecutionRequest): String? {
        val node = runCatching { objectMapper.readTree(request.arguments()) }.getOrNull() ?: return null
        return node.get("path")?.asString()
            ?: node.get("to")?.asString()
            ?: node.get("url")?.asString()
    }
}
