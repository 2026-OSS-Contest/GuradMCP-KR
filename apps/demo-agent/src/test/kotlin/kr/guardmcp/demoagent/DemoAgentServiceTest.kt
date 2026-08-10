package kr.guardmcp.demoagent

import dev.langchain4j.agent.tool.ToolExecutionRequest
import tools.jackson.databind.ObjectMapper
import tools.jackson.module.kotlin.jacksonObjectMapper
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.booleans.shouldBeFalse
import io.kotest.matchers.booleans.shouldBeTrue
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.collections.shouldContainAll
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain as shouldContainString
import io.kotest.matchers.string.shouldNotContain as shouldNotContainString
import kr.guardmcp.demoagent.agent.DemoAgentService
import kr.guardmcp.demoagent.agent.DeterministicPlanner
import kr.guardmcp.demoagent.agent.ToolCallChainLogger
import kr.guardmcp.demoagent.config.DemoAgentProperties
import kr.guardmcp.demoagent.mcp.DemoMode
import kr.guardmcp.demoagent.mcp.DirectToolInvoker
import kr.guardmcp.demoagent.mcp.GatewayToolInvoker
import kr.guardmcp.demoagent.mcp.McpCallResult
import kr.guardmcp.demoagent.mcp.ToolInvoker
import kr.guardmcp.demoagent.support.GatewayStub
import kr.guardmcp.demoagent.support.ToolsStub
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
            val service = serviceWith(gateway, gateway = gateway)

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

    "guarded path fails closed when the gateway omits the _guardmcp block" {
        val stub = GatewayStub().start()
        try {
            val gateway = GatewayToolInvoker(
                DemoAgentProperties(gatewayUrl = stub.baseUrl),
                mapper,
                HttpClient.newHttpClient(),
            )
            val result = gateway.call(
                ToolExecutionRequest.builder().name("missing_guard").arguments("{}").build(),
                "s-missing",
            )
            // No verdict → must be treated as blocked, never as an implicit allow.
            result.blocked.shouldBeTrue()
            result.verdict shouldBe "error"
            result.resultJson.shouldBeNull()
        } finally {
            stub.stop()
        }
    }

    "guarded path fails closed on an unrecognized verdict" {
        val stub = GatewayStub().start()
        try {
            val gateway = GatewayToolInvoker(
                DemoAgentProperties(gatewayUrl = stub.baseUrl),
                mapper,
                HttpClient.newHttpClient(),
            )
            val result = gateway.call(
                ToolExecutionRequest.builder().name("unknown_verdict").arguments("{}").build(),
                "s-unknown",
            )
            result.blocked.shouldBeTrue()
            result.verdict shouldBe "error"
        } finally {
            stub.stop()
        }
    }

    "guarded path fails closed on a non-2xx gateway status" {
        val stub = GatewayStub().start()
        try {
            val gateway = GatewayToolInvoker(
                DemoAgentProperties(gatewayUrl = stub.baseUrl),
                mapper,
                HttpClient.newHttpClient(),
            )
            val result = gateway.call(
                ToolExecutionRequest.builder().name("server_error").arguments("{}").build(),
                "s-5xx",
            )
            result.blocked.shouldBeTrue()
            result.verdict shouldBe "error"
        } finally {
            stub.stop()
        }
    }

    "consultation log masks all three Korean PII types and keeps the lookup allowed" {
        val stub = GatewayStub().start()
        val tools = ToolsStub().start()
        try {
            val gateway = GatewayToolInvoker(
                DemoAgentProperties(gatewayUrl = stub.baseUrl),
                mapper,
                HttpClient.newHttpClient(),
            )
            val direct = DirectToolInvoker(
                DemoAgentProperties(demoMcpToolsUrl = tools.baseUrl),
                mapper,
                HttpClient.newHttpClient(),
            )
            val service = serviceWith(gateway, direct, gateway = gateway)

            val run = service.runConsultationLog(sessionId = "s-consult")

            // The lookup is legitimate, so it is masked and delivered — not blocked.
            run.guarded.verdict shouldBe "mask_then_allow"
            run.guarded.policyIds shouldContain "mask_korean_pii_response"
            run.guarded.maskedTypes.map { it.tag } shouldContainAll listOf("PHONE", "RRN_LIKE", "BANK_ACCOUNT")
            run.maskedSpanCount shouldBe 4
            run.summary shouldContainString "마스킹"

            // NFR-04: nothing unmasked may survive on the guarded side.
            run.guarded.text shouldNotContainString "010-3456-7890"
            run.guarded.text shouldNotContainString "881124-2300149"
            run.guarded.text shouldNotContainString "110-234-567890"

            // The unguarded run is the "before" half of the Mask Diff, and it does leak.
            val vulnerable = run.vulnerable.shouldNotBeNull()
            vulnerable.text shouldContainString "010-3456-7890"
            vulnerable.maskedTypes.shouldBeEmpty()
        } finally {
            tools.stop()
            stub.stop()
        }
    }

    "consultation log can skip the unguarded comparison run" {
        val stub = GatewayStub().start()
        try {
            val gateway = GatewayToolInvoker(
                DemoAgentProperties(gatewayUrl = stub.baseUrl),
                mapper,
                HttpClient.newHttpClient(),
            )
            val service = serviceWith(gateway, gateway = gateway)

            val run = service.runConsultationLog(withVulnerable = false, sessionId = "s-guarded-only")

            run.vulnerable.shouldBeNull()
            run.ticketId shouldBe "TCK-2026-9001"
        } finally {
            stub.stop()
        }
    }

    "pii lookup preserves the merged guard verdict contract" {
        val stub = GatewayStub().start()
        try {
            val gateway = GatewayToolInvoker(
                DemoAgentProperties(gatewayUrl = stub.baseUrl),
                mapper,
                HttpClient.newHttpClient(),
            )
            val service = serviceWith(gateway, gateway = gateway)

            val body = service.runPiiLookup()

            body.get("verdict").asString() shouldBe "mask_then_allow"
            body.get("policyIds")[0].asString() shouldBe "mask_korean_pii_response"
            body.get("result").get("content")[0].get("phone").asString() shouldBe "[PHONE]"
        } finally {
            stub.stop()
        }
    }
})
