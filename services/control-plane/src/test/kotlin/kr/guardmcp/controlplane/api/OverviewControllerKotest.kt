package kr.guardmcp.controlplane.api

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainAll
import io.kotest.matchers.shouldBe
import kr.guardmcp.controlplane.domain.EventBroadcaster
import kr.guardmcp.controlplane.domain.GuardEventRepository
import kr.guardmcp.controlplane.domain.PolicyBenchmarkResultStore
import kr.guardmcp.controlplane.domain.PolicyFixtures
import kr.guardmcp.controlplane.domain.PolicyStore
import kr.guardmcp.controlplane.domain.RawPayloadCrypto
import kr.guardmcp.controlplane.domain.RawPayloadStore
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.TransactionStatus
import java.time.Clock

class OverviewControllerKotest : StringSpec({
    // This test never calls policyStats()/submitBenchmarkResult()/insert() — the only methods
    // touching either store — so unconnected/never-invoked stand-ins are safe to wire in here.
    val neverInvokedTransactionManager = object : PlatformTransactionManager {
        override fun getTransaction(definition: TransactionDefinition?): TransactionStatus = error("not used by this test")
        override fun commit(status: TransactionStatus) = error("not used by this test")
        override fun rollback(status: TransactionStatus) = error("not used by this test")
    }

    fun policyController(clock: Clock) =
        PolicyController(
            PolicyStore(clock).also(PolicyFixtures::syncInto),
            GuardEventRepository(
                JdbcTemplate(),
                RawPayloadStore(JdbcTemplate(), RawPayloadCrypto("", "v1")),
                neverInvokedTransactionManager,
            ),
            PolicyBenchmarkResultStore(JdbcTemplate()),
            clock,
            EventBroadcaster(),
            "",
        )

    "policy response keeps the synced packs" {
        val packs = policyController(Clock.systemUTC()).policyPacks().map { it.id }
        packs.shouldContainAll("default", "korean-pii")
        packs.size shouldBe 2
    }
})
