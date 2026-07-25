package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.GuardEvent
import kr.guardmcp.controlplane.domain.GuardEventStore
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Instant
import java.util.UUID

data class SessionTimeline(
    val sessionId: UUID,
    val scenarioId: String,
    val title: String,
    val createdAt: Instant,
    val events: List<GuardEvent>,
)

@RestController
@RequestMapping("/api/v1")
class SessionTimelineController(private val eventStore: GuardEventStore) {
    @GetMapping("/sessions/{sessionId}/timeline")
    fun timeline(@PathVariable sessionId: UUID): SessionTimeline {
        val session = eventStore.session(sessionId)
            ?: throw ApiException(HttpStatus.NOT_FOUND, "session_not_found", "session $sessionId not found")
        return SessionTimeline(
            sessionId = session.id,
            scenarioId = session.scenarioId,
            title = session.title,
            createdAt = session.createdAt,
            events = eventStore.timeline(sessionId),
        )
    }
}
