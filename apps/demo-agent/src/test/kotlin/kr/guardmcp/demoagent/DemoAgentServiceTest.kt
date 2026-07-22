package kr.guardmcp.demoagent

import dev.langchain4j.agent.tool.ToolExecutionRequest
import tools.jackson.databind.ObjectMapper
import tools.jackson.module.kotlin.jacksonObjectMapper
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.booleans.shouldBeFalse
import io.kotest.matchers.booleans.shouldBeTrue
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain as shouldContainString
import kr.guardmcp.demoagent.agent.DemoAgentService
import kr.guardmcp.demoagent.agent.DeterministicPlanner
import kr.guardmcp.demoagent.agent.ToolCallChainLogger
import kr.guardmcp.demoagent.config.DemoAgentProperties
import kr.guardmcp.demoagent.mcp.DemoMode
import kr.guardmcp.demoagent.mcp.GatewayToolInvoker
import kr.guardmcp.demoagent.mcp.McpCallResult
import kr.guardmcp.demoagent.mcp.SandboxToolInvoker
import kr.guardmcp.demoagent.mcp.ToolInvoker
import kr.guardmcp.demoagent.support.GatewayStub
import java.net.http.HttpClient

/** Records what it was asked to run so tests can assert on the send_email body. */
private class RecordingInvoker(override val mode: DemoMode) : ToolInvoker {
    val requests = mutableListOf<ToolExecutionRequest>()
    override fun call(request: ToolExecutionRequest, sessionId: String): McpCallResult {
        requests += request
        val payload = if (request.name() == "read_file") "ENV_DATA_SYNTHETIC" else null
        return McpCallResult(
            tool = request.name(), mode = mode, source = "recording", verdict = "executed",
            blocked = false, riskScore = 0, policyIds = emptyList(), detections = emptyList(),
            resultJson = payload, message = null, rpcCode = null,
        )
    }
}

class DemoAgentServiceTest : StringSpec({

    val mapper: ObjectMapper = jacksonObjectMapper()
    val planner = DeterministicPlanner()
    val logger = ToolCallChainLogger(mapper)

    fun serviceWith(vararg invokers: ToolInvoker, gateway: GatewayToolInvoker): DemoAgentService =
        DemoAgentService(invokers.toList(), gateway, planner, logger, mapper)

    "guarded run is blocked at read_file and never reaches send_email" {
        val stub = GatewayStub().start()
        try {
            val gateway = GatewayToolInvoker(
                DemoAgentProperties(gatewayUrl = stub.baseUrl),
                mapper,
                HttpClient.newHttpClient(),
            )
            val service = serviceWith(gateway, SandboxToolInvoker(), gateway = gateway)

            val run = service.runReadmeSummary(DemoMode.GUARDED)

            run.chain.size shouldBe 1
            run.chain[0].tool shouldBe "read_file"
            run.chain[0].blocked.shouldBeTrue()
            run.chain[0].policyIds shouldContain "block_env_file_read"
            run.outcome.blocked.shouldBeTrue()
            run.outcome.leaked.shouldBeFalse()
            run.outcome.stoppedAtStep shouldBe 1
            run.outcome.summary shouldContainString "block_env_file_read"
        } finally {
            stub.stop()
        }
    }

    "vulnerable run leaks and forwards the read_file result into send_email" {
        val recording = RecordingInvoker(DemoMode.VULNERABLE)
        val gateway = GatewayToolInvoker(DemoAgentProperties(), mapper, HttpClient.newHttpClient())
        val service = serviceWith(recording, gateway = gateway)

        val run = service.runReadmeSummary(DemoMode.VULNERABLE)

        run.chain.map { it.tool } shouldBe listOf("read_file", "send_email")
        run.outcome.leaked.shouldBeTrue()
        run.outcome.blocked.shouldBeFalse()
        run.outcome.stoppedAtStep.shouldBeNull()
        // The secret slot in send_email was filled with the read_file result.
        val sendEmail = recording.requests.single { it.name() == "send_email" }
        mapper.readTree(sendEmail.arguments()).get("body").asString() shouldBe "ENV_DATA_SYNTHETIC"
    }

    "pii lookup preserves the merged guard verdict contract" {
        val stub = GatewayStub().start()
        try {
            val gateway = GatewayToolInvoker(
                DemoAgentProperties(gatewayUrl = stub.baseUrl),
                mapper,
                HttpClient.newHttpClient(),
            )
            val service = serviceWith(gateway, SandboxToolInvoker(), gateway = gateway)

            val body = service.runPiiLookup()

            body.get("verdict").asString() shouldBe "mask_then_allow"
            body.get("policyIds")[0].asString() shouldBe "mask_korean_pii_response"
            body.get("result").get("content")[0].get("phone").asString() shouldBe "[PHONE]"
        } finally {
            stub.stop()
        }
    }
})
