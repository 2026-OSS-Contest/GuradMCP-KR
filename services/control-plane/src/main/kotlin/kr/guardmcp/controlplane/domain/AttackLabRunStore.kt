package kr.guardmcp.controlplane.domain

import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Instant
import java.util.UUID

data class AttackLabRun(
    val runId: UUID,
    val scenarioId: String,
    val status: String,
    val requestedAt: Instant,
)

@Component
class AttackLabRunStore(private val clock: Clock) {
    private val lock = Any()
    private val runs = mutableListOf<AttackLabRun>()

    val knownScenarioIds: Set<String> = (1..8).map { "T-%02d".format(it) }.toSet()

    /** Records a run request; execution is owned by the Attack Lab runner (GMCP-55). */
    fun enqueue(scenarioId: String): AttackLabRun? {
        if (scenarioId !in knownScenarioIds) return null
        val run = AttackLabRun(UUID.randomUUID(), scenarioId, "queued", clock.instant())
        synchronized(lock) { runs += run }
        return run
    }
}
