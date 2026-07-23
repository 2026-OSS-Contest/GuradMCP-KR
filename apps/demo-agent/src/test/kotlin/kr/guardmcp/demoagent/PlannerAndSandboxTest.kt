package kr.guardmcp.demoagent

import dev.langchain4j.agent.tool.ToolExecutionRequest
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.booleans.shouldBeFalse
import io.kotest.matchers.shouldBe
import kr.guardmcp.demoagent.agent.DeterministicPlanner
import kr.guardmcp.demoagent.mcp.SandboxToolInvoker

class PlannerAndSandboxTest : StringSpec({

    "planner reproduces the T-01 read_file then send_email chain" {
        val plan = DeterministicPlanner().planReadmeSummary()
        plan.map { it.name() } shouldBe listOf("read_file", "send_email")
        plan[0].arguments() shouldBe """{"path":".env"}"""
    }

    "sandbox reads the synthetic env without any inspection" {
        val result = SandboxToolInvoker().call(
            ToolExecutionRequest.builder().name("read_file").arguments("""{"path":".env"}""").build(),
            "s-test",
        )
        result.blocked.shouldBeFalse()
        result.verdict shouldBe "executed"
        result.source shouldBe "sandbox"
        result.resultJson!!.contains("SMTP_PASSWORD") shouldBe true
    }

    "sandbox send_email reports a sandboxed send" {
        val result = SandboxToolInvoker().call(
            ToolExecutionRequest.builder().name("send_email").arguments("""{"to":"a@b.c"}""").build(),
            "s-test",
        )
        result.blocked.shouldBeFalse()
        result.tool shouldBe "send_email"
    }
})
