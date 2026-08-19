package kr.guardmcp.controlplane.api

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainAll
import io.kotest.matchers.shouldBe
import kr.guardmcp.controlplane.domain.GuardEventRepository
import kr.guardmcp.controlplane.domain.PolicyBenchmarkResultStore
import kr.guardmcp.controlplane.domain.PolicyStore
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Clock

class OverviewControllerKotest : StringSpec({
    // This test never calls policyStats()/submitBenchmarkResult() — the only methods touching
    // either store — so unconnected JdbcTemplates (no DataSource) are safe to wire in here.
    fun policyController(clock: Clock) =
        PolicyController(
            PolicyStore(clock),
            GuardEventRepository(JdbcTemplate()),
            PolicyBenchmarkResultStore(JdbcTemplate()),
            clock,
        )

    "policy response keeps the two seeded packs" {
        val packs = policyController(Clock.systemUTC()).policyPacks().map { it.id }
        packs.shouldContainAll("default", "korean-pii")
        packs.size shouldBe 2
    }
})
