package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.EventStreamHub
import kr.guardmcp.controlplane.health.TcpDependenciesHealthIndicator
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter

@RestController
@RequestMapping("/api/v1")
class EventStreamController(
    private val hub: EventStreamHub,
    private val healthIndicator: TcpDependenciesHealthIndicator,
) {
    @GetMapping("/events/stream", produces = [MediaType.TEXT_EVENT_STREAM_VALUE])
    fun stream(): SseEmitter {
        val emitter = SseEmitter(NO_TIMEOUT)
        val subscriptionId = hub.subscribe(
            transport = { event ->
                emitter.send(
                    SseEmitter.event()
                        .id(event.id.toString())
                        .name(event.type)
                        .data(event.payload, MediaType.APPLICATION_JSON),
                )
            },
            onClose = emitter::complete,
        )
        emitter.onCompletion { hub.unsubscribe(subscriptionId) }
        emitter.onTimeout { hub.unsubscribe(subscriptionId) }
        emitter.onError { hub.unsubscribe(subscriptionId) }

        // Initial snapshot so a (re)connecting console knows the gateway state immediately.
        val health = healthIndicator.health()
        val dependencies = health.details["dependencies"]
        hub.publishGatewayHealth(
            status = health.status.code.lowercase(),
            dependencies = if (dependencies is Map<*, *>) {
                dependencies.entries.associate { (key, value) -> key.toString() to (value == true) }
            } else {
                emptyMap()
            },
        )
        return emitter
    }

    companion object {
        /** Reconnection policy is owned by the console (exponential backoff, GMCP-86). */
        const val NO_TIMEOUT = 0L
    }
}
