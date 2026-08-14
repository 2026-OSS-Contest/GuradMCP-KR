package kr.guardmcp.controlplane.domain

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.core.io.ClassPathResource
import org.springframework.stereotype.Component

data class AttackScenarioSummary(
    val id: String,
    val title: String,
    val description: String,
    /** `apps/console/lib/api/types.ts`'s `AttackScenario.available` — not runnable yet lists as 준비 중. */
    val available: Boolean,
    val modes: List<String>,
)

/**
 * `GET /attacklab/scenarios` (GMCP-80 §3.4). Reads the same catalog the Attack Lab runner
 * (GMCP-55, attack-lab/runner) executes against — `build.gradle.kts`'s `processResources` task
 * bundles attack-lab/scenarios/catalog.json onto the classpath at build time — rather than a
 * hand-maintained id/title/implemented list, so a scenario's automation state can never drift
 * from what this endpoint reports (completion criterion: "하드코딩 금지").
 *
 * Scoped to [AttackLabRunStore.THREAT_IDS] (PROJECT.md 3.2's T-01..T-08); the catalog has since
 * grown a T-09 (system-prompt leak) that this endpoint's `id` contract does not cover.
 */
@Component
class AttackLabCatalog {
    private val scenarios: List<AttackScenarioSummary>

    init {
        val objectMapper = ObjectMapper()
        val root = ClassPathResource("attacklab/catalog.json").inputStream.use {
            objectMapper.readValue(it, object : TypeReference<Map<String, Any?>>() {})
        }

        @Suppress("UNCHECKED_CAST")
        val threats = (root["threats"] as List<Map<String, Any?>>)
            .filter { it["id"] in AttackLabRunStore.THREAT_IDS }
        @Suppress("UNCHECKED_CAST")
        val catalogScenarios = root["scenarios"] as List<Map<String, Any?>>

        scenarios = threats.map { threat ->
            val threatId = threat["id"] as String
            val attackScenarios = catalogScenarios.filter { it["threat"] == threatId && it["kind"] == "attack" }
            // A threat counts as demonstrable only once every one of its attack scenarios is
            // fully automated ("probe"); a single "manual" entry (still blocked on an
            // unmerged gateway feature) means the pair-mode demo can't run it end to end yet.
            val implemented = attackScenarios.isNotEmpty() && attackScenarios.all {
                @Suppress("UNCHECKED_CAST")
                (it["automation"] as Map<String, Any?>)["mode"] == "probe"
            }
            AttackScenarioSummary(
                id = threatId,
                title = threat["name"] as String,
                description = threat["summary"] as String,
                available = implemented,
                modes = if (implemented) listOf("vulnerable", "guarded") else emptyList(),
            )
        }.sortedBy { it.id }
    }

    fun list(): List<AttackScenarioSummary> = scenarios
}
