package kr.guardmcp.demoagent.mcp

import dev.langchain4j.agent.tool.ToolExecutionRequest
import dev.langchain4j.service.tool.ToolExecutor

/**
 * A place the agent can send a LangChain4j [ToolExecutionRequest]. Both the guarded
 * gateway client and the vulnerable sandbox implement this, so the orchestrator picks
 * one by mode and the rest of the pipeline is byte-for-byte identical — that identity
 * is what makes "no agent code changes" (proposal 4.3) true rather than aspirational.
 *
 * It also satisfies LangChain4j's [ToolExecutor] contract, so GMCP-57 can drop an
 * LLM-driven `AiServices` in front of the exact same executors.
 */
interface ToolInvoker : ToolExecutor {
    val mode: DemoMode

    fun call(request: ToolExecutionRequest, sessionId: String): McpCallResult

    override fun execute(request: ToolExecutionRequest, memoryId: Any?): String =
        call(request, memoryId?.toString() ?: "lc4j").let { it.resultJson ?: it.message ?: "" }
}
