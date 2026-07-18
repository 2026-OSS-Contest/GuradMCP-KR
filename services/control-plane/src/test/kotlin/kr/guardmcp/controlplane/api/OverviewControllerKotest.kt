package kr.guardmcp.controlplane.api

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainAll
import io.kotest.matchers.shouldBe

class OverviewControllerKotest : StringSpec({
    "policy response keeps the two seeded packs" {
        val packs = OverviewController().policies()["packs"] as List<*>
        packs.shouldContainAll("default", "korean-pii")
        packs.size shouldBe 2
    }
})
