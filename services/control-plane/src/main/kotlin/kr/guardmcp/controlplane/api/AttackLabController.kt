package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.AttackLabRun
import kr.guardmcp.controlplane.domain.AttackLabRunStore
import kr.guardmcp.controlplane.domain.AttackScenarioSummary
import kr.guardmcp.controlplane.domain.AttackLabCatalog
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

/** `apps/console/lib/api/types.ts`'s `AttackScenariosResponse`. */
data class AttackScenariosResponse(val scenarios: List<AttackScenarioSummary>)

@RestController
@RequestMapping("/api/v1")
class AttackLabController(private val runStore: AttackLabRunStore, private val catalog: AttackLabCatalog) {
    @GetMapping("/attacklab/scenarios")
    fun scenarios(): AttackScenariosResponse = AttackScenariosResponse(catalog.list())

    @PostMapping("/attacklab/run/{scenarioId}")
    @ResponseStatus(HttpStatus.ACCEPTED)
    fun run(@PathVariable scenarioId: String): AttackLabRun =
        runStore.enqueue(scenarioId)
            ?: throw ApiException(
                HttpStatus.NOT_FOUND,
                "scenario_not_found",
                "scenario $scenarioId is not one of T-01..T-08",
            )
}
