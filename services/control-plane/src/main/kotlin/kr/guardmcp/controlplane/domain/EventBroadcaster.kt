package kr.guardmcp.controlplane.domain

import org.springframework.stereotype.Component
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter

/**
 * `GET /events/stream` (fix-api.md §5): a single fan-out point for the console's `guard.event` /
 * `approval.created` / `approval.resolved` / `policy.reloaded` stream, shared by
 * [AuditEventController.ingest], [ApprovalStore], and [PolicyController.sync] — three different
 * domains publishing onto one connection, rather than each growing its own copy of the
 * subscriber-list bookkeeping [ServerRegistryStore] and [GuardSettingsStore] already have.
 *
 * `publish` is always called outside whatever lock produced the event (see those three
 * callers): a stalled subscriber's slow `send` must never hold up the mutation that triggered
 * it, matching [ServerRegistryStore.broadcast]'s own "push outside the lock" note.
 *
 * `open` (Kotlin's classes/methods default to `final`) purely so [ApprovalStoreKotest] can spy
 * on `publish` with a subclass instead of standing up a real HTTP layer to observe an SSE frame.
 */
@Component
open class EventBroadcaster {
    private val lock = Any()
    private val emitters = mutableListOf<SseEmitter>()

    open fun subscribe(emitter: SseEmitter) {
        synchronized(lock) { emitters += emitter }
        emitter.onCompletion { synchronized(lock) { emitters -= emitter } }
        emitter.onTimeout { emitter.complete(); synchronized(lock) { emitters -= emitter } }
        emitter.onError { synchronized(lock) { emitters -= emitter } }
        // Unlike ServerController/SettingsController's streams, this one has no snapshot to push
        // on connect — every event here is a live occurrence, not a resendable current state. A
        // comment (SSE's `:`-prefixed line, invisible to EventSource's message listeners and to
        // this class's own `publish`) forces Tomcat to commit and flush the response right away
        // instead of holding it uncommitted until the first real event; without it a client
        // connecting during a quiet period sees no response at all until one arrives.
        try {
            emitter.send(SseEmitter.event().comment("connected"))
        } catch (exception: Exception) {
            synchronized(lock) { emitters -= emitter }
            emitter.completeWithError(exception)
        }
    }

    open fun publish(eventName: String, data: Any) {
        val targets = synchronized(lock) { emitters.toList() }
        for (emitter in targets) {
            try {
                emitter.send(SseEmitter.event().name(eventName).data(data))
            } catch (exception: Exception) {
                synchronized(lock) { emitters -= emitter }
                emitter.completeWithError(exception)
            }
        }
    }
}
