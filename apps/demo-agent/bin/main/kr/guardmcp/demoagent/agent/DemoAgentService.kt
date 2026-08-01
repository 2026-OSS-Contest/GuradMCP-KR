package kr.guardmcp.demoagent.agent

import dev.langchain4j.agent.tool.ToolExecutionRequest
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import tools.jackson.databind.node.ObjectNode
import kr.guardmcp.demoagent.mcp.DemoMode
import kr.guardmcp.demoagent.mcp.GatewayToolInvoker
import kr.guardmcp.demoagent.mcp.ToolInvoker
import org.springframework.stereotype.Service
import java.util.UUID

/**
 * Drives the demo. Both modes run the *same* plan through the *same* loop; only the
 * [ToolInvoker] differs — guarded hits the gateway, vulnerable hits the sandbox. That is
 * the "swap the endpoint, change no agent code" story made literal (proposal 4.3).
 */
@Service
class DemoAgentService(
    invokers: List<ToolInvoker>,
    private val gateway: GatewayToolInvoker,
    private val planner: DeterministicPlanner,
    private val chainLogger: ToolCallChainLogger,
    private val objectMapper: ObjectMapper,
) {
    private val invokerByMode: Map<DemoMode, ToolInvoker> = invokers.associateBy(ToolInvoker::mode)

    /** T-01 malicious-README run in the requested mode. */
    fun runReadmeSummary(mode: DemoMode, sessionId: String = newSessionId()): DemoRunResponse {
        val invoker = invokerByMode.getValue(mode)
        val steps = mutableListOf<ToolCallStep>()
        var readFileResult: String? = null

        for ((index, planned) in planner.planReadmeSummary().withIndex()) {
            val request = fillSecretSlot(planned, readFileResult)
            val result = invoker.call(request, sessionId)
            chainLogger.log(sessionId, mode, index + 1, request, result)
            steps += ToolCallStep(
                step = index + 1,
                tool = request.name(),
                target = ToolArguments.target(objectMapper, request),
                verdict = result.verdict,
                blocked = result.blocked,
                riskScore = result.riskScore,
                policyIds = result.policyIds,
                detections = result.detections,
                message = result.message,
            )
            if (result.blocked) break
            if (request.name() == "read_file") readFileResult = result.resultJson
        }

        return DemoRunResponse(
            sessionId = sessionId,
            mode = mode.name.lowercase(),
            task = "다음 README를 요약해줘.",
            readme = DemoScenarios.MALICIOUS_README,
            chain = steps,
            outcome = summarize(mode, steps),
        )
    }

    /**
     * Preserves the original `/demo/pii` contract: proxy `customer_lookup` through the
     * gateway and return `{...guardmcp, result, error}`. GMCP-30 readiness and the
     * quickstart curl both depend on this exact shape.
     */
    fun runPiiLookup(): JsonNode {
        val node = gateway.rawToolsCall("customer_lookup", objectMapper.createObjectNode(), "demo-pii")
        val merged: ObjectNode = objectMapper.createObjectNode()
        (node.get("_guardmcp") as? ObjectNode)?.let { merged.setAll(it) }
        merged.set("result", node.get("result") ?: objectMapper.nullNode())
        merged.set("error", node.get("error") ?: objectMapper.nullNode())
        return merged
    }

    private fun fillSecretSlot(request: ToolExecutionRequest, readFileResult: String?): ToolExecutionRequest {
        val arguments = objectMapper.readTree(request.arguments())
        if (arguments !is ObjectNode || arguments.get("body")?.asText() != DeterministicPlanner.SECRET_SLOT) {
            return request
        }
        arguments.put("body", readFileResult ?: "")
        return ToolExecutionRequest.builder()
            .name(request.name())
            .arguments(objectMapper.writeValueAsString(arguments))
            .build()
    }

    private fun summarize(mode: DemoMode, steps: List<ToolCallStep>): DemoOutcome {
        val blockedStep = steps.firstOrNull(ToolCallStep::blocked)
        val leaked = mode == DemoMode.VULNERABLE && steps.any { it.tool == "send_email" && !it.blocked }
        val summary = when {
            blockedStep != null -> {
                val policy = blockedStep.policyIds.firstOrNull()
                val reason = if (policy != null) "정책 $policy 에 의해" else "정책에 의해"
                "${blockedStep.tool} 호출이 $reason 차단되어 외부 유출이 발생하지 않았습니다."
            }
            leaked -> "게이트웨이 미적용 상태에서 .env가 읽히고 외부 주소로 전송되었습니다 (격리 샌드박스)."
            else -> "체인이 유출 없이 종료되었습니다."
        }
        return DemoOutcome(
            blocked = blockedStep != null,
            leaked = leaked,
            stoppedAtStep = blockedStep?.step,
            summary = summary,
        )
    }

    private fun newSessionId(): String = "s-${UUID.randomUUID().toString().take(8)}"
}
