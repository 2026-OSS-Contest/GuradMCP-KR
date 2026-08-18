package kr.guardmcp.controlplane.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe

class AttackLabCatalogKotest : StringSpec({
    val scenarios = AttackLabCatalog().list()

    "covers exactly PROJECT.md 3.2's T-01..T-08, not the catalog's later T-09" {
        scenarios.map { it.id }.toSet() shouldBe AttackLabRunStore.THREAT_IDS
    }

    "a threat is available only once every one of its attack scenarios is fully automated" {
        // T-06 (Confused Deputy) has one probe scenario and one still-manual scenario blocked
        // on GMCP-64 — not runnable end to end yet, so it must not be reported as available.
        scenarios.single { it.id == "T-06" }.available shouldBe false
        scenarios.single { it.id == "T-06" }.modes shouldBe emptyList()
    }

    "a threat whose every attack scenario is automated is available in both run modes" {
        val t01 = scenarios.single { it.id == "T-01" }
        t01.available shouldBe true
        t01.modes shouldContainExactly listOf("vulnerable", "guarded")
    }

    "a threat with a single still-manual scenario is not available" {
        // T-05's A-09 needs multi-step automation in the runner, which GMCP-65 left as
        // follow-up scope, so the threat still cannot be run end to end.
        scenarios.single { it.id == "T-05" }.available shouldBe false
    }

    "a threat becomes available once its last manual scenario is automated" {
        // T-08 was in the list above until GMCP-70 settled the bulk-disclosure verdict
        // and A-14 became a probe. Asserted here rather than dropped, so the catalog and
        // this endpoint cannot drift apart silently.
        val t08 = scenarios.single { it.id == "T-08" }
        t08.available shouldBe true
        t08.modes shouldContainExactly listOf("vulnerable", "guarded")
    }

    "title and description come from the catalog's threat name/summary, not a hardcoded string" {
        val t01 = scenarios.single { it.id == "T-01" }
        t01.title shouldBe "간접 프롬프트 인젝션"
        t01.description.isNotBlank() shouldBe true
    }
})
