package kr.guardmcp.controlplane.api

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainAll
import io.kotest.matchers.shouldBe
import kr.guardmcp.controlplane.domain.PolicyStore
import java.time.Clock

class OverviewControllerKotest : StringSpec({
    "policy response keeps the two seeded packs" {
        val packs = PolicyController(PolicyStore(Clock.systemUTC())).policyPacks().map { it.id }
        packs.shouldContainAll("default", "korean-pii")
        packs.size shouldBe 2
    }
})
