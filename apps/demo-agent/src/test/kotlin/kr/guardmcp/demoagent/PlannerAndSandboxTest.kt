package kr.guardmcp.demoagent

import dev.langchain4j.agent.tool.ToolExecutionRequest
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.booleans.shouldBeFalse
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import kr.guardmcp.demoagent.agent.DeterministicPlanner
import kr.guardmcp.demoagent.config.DemoAgentProperties
import kr.guardmcp.demoagent.mcp.DirectToolInvoker
import kr.guardmcp.demoagent.support.ToolsStub
import tools.jackson.module.kotlin.jacksonObjectMapper
import java.net.http.HttpClient

class PlannerAndSandboxTest : StringSpec({

    val mapper = jacksonObjectMapper()

    fun invokerFor(stub: ToolsStub) = DirectToolInvoker(
        DemoAgentProperties(demoMcpToolsUrl = stub.baseUrl),
        mapper,
        HttpClient.newHttpClient(),
    )

    "planner reproduces the T-01 read_file then send_email chain" {
        val plan = DeterministicPlanner().planReadmeSummary()
        plan.map { it.name() } shouldBe listOf("read_file", "send_email")
        plan[0].arguments() shouldBe """{"path":".env"}"""
    }

    "vulnerable path reads the synthetic env straight from the tool server" {
        val stub = ToolsStub().start()
        try {
            val result = invokerFor(stub).call(
                ToolExecutionRequest.builder().name("read_file").arguments("""{"path":".env"}""").build(),
                "s-test",
            )
            result.blocked.shouldBeFalse()
            result.verdict shouldBe "executed"
            result.source shouldBe "demo-mcp-tools"
            result.resultJson!! shouldContain "SMTP_PASSWORD"
            stub.calls shouldBe listOf("read_file")
        } finally {
            stub.stop()
        }
    }

    "vulnerable path sends email through the tool server's local outbox" {
        val stub = ToolsStub().start()
        try {
            val result = invokerFor(stub).call(
                ToolExecutionRequest.builder().name("send_email").arguments("""{"to":"a@b.c"}""").build(),
                "s-test",
            )
            result.blocked.shouldBeFalse()
            result.tool shouldBe "send_email"
            result.resultJson!! shouldContain "outbox"
        } finally {
            stub.stop()
        }
    }

    "a failing tool never reports as blocked on the unguarded path" {
        val stub = ToolsStub().start()
        try {
            val result = invokerFor(stub).call(
                ToolExecutionRequest.builder().name("broken_tool").arguments("{}").build(),
                "s-test",
            )
            // The vulnerable path has no protection to credit: an error is an error,
            // never a block, or the before/after comparison would overstate its safety.
            result.blocked.shouldBeFalse()
            result.verdict shouldBe "error"
        } finally {
            stub.stop()
        }
    }

    "an unreachable tool server is reported without claiming a block" {
        // Port 1 is reserved and refuses connections, so this exercises the transport path.
        val invoker = DirectToolInvoker(
            DemoAgentProperties(demoMcpToolsUrl = "http://127.0.0.1:1"),
            mapper,
            HttpClient.newHttpClient(),
        )
        val result = invoker.call(
            ToolExecutionRequest.builder().name("read_file").arguments("{}").build(),
            "s-test",
        )
        result.blocked.shouldBeFalse()
        result.verdict shouldBe "error"
    }
})
