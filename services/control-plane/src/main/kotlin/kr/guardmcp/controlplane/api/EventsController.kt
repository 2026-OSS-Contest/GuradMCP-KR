package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.EventBroadcaster
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter

/**
 * fix-api.md §5: the console subscribes to `guard.event` / `approval.created` /
 * `approval.resolved` / `policy.reloaded` on one connection (`apps/console/lib/sse.ts`).
 * Publishers are [kr.guardmcp.controlplane.domain.EventBroadcaster]'s other callers —
 * [AuditEventController.ingest], [kr.guardmcp.controlplane.domain.ApprovalStore], and
 * [PolicyController.sync] — this controller only opens the subscription.
 */
@RestController
@RequestMapping("/api/v1")
class EventsController(private val eventBroadcaster: EventBroadcaster) {
    @GetMapping("/events/stream", produces = [MediaType.TEXT_EVENT_STREAM_VALUE])
    fun stream(): SseEmitter {
        // Bounded rather than infinite, same reasoning as ServerController.stream/SettingsController
        // .stream: an abandoned connection should eventually free its server thread, and the
        // console's SSE client (lib/sse.ts) reconnects on its own with backoff.
        val emitter = SseEmitter(STREAM_TIMEOUT_MS)
        eventBroadcaster.subscribe(emitter)
        return emitter
    }

    private companion object {
        const val STREAM_TIMEOUT_MS = 30 * 60 * 1000L
    }
}
