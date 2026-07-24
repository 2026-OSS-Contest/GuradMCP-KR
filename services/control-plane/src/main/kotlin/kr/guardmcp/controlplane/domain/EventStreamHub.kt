package kr.guardmcp.controlplane.domain

import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** One server-sent event: a monotonic id, one of the four stream types, and its JSON payload. */
data class StreamEvent(
    val id: Long,
    val type: String,
    val payload: Any,
    val emittedAt: Instant,
)

/** Delivers one event to a subscriber; throwing marks the subscriber as gone. */
fun interface StreamTransport {
    fun deliver(event: StreamEvent)
}

/**
 * Fan-out hub for the console event stream. Each subscriber owns a bounded queue drained
 * by its own virtual thread; a subscriber whose queue overflows is disconnected instead of
 * slowing the publishers down (explicit backpressure policy).
 */
@Component
class EventStreamHub(private val clock: Clock) {
    private val subscribers = ConcurrentHashMap<UUID, Subscriber>()
    private val nextEventId = AtomicLong(0)

    private inner class Subscriber(
        val id: UUID,
        capacity: Int,
        private val transport: StreamTransport,
        private val onClose: () -> Unit,
    ) {
        private val queue = LinkedBlockingQueue<StreamEvent>(capacity)
        private val open = AtomicBoolean(true)

        val worker: Thread = Thread.ofVirtual().name("sse-subscriber-$id").start {
            try {
                while (open.get() || queue.isNotEmpty()) {
                    val event = queue.take()
                    transport.deliver(event)
                }
            } catch (_: InterruptedException) {
                // closed while idle
            } catch (_: Exception) {
                // transport failed (client gone)
            } finally {
                close()
            }
        }

        fun offer(event: StreamEvent): Boolean = open.get() && queue.offer(event)

        fun close() {
            if (!open.compareAndSet(true, false)) return
            subscribers.remove(id)
            worker.interrupt()
            onClose()
        }
    }

    fun subscribe(transport: StreamTransport, capacity: Int = DEFAULT_CAPACITY, onClose: () -> Unit = {}): UUID {
        val id = UUID.randomUUID()
        subscribers[id] = Subscriber(id, capacity, transport, onClose)
        return id
    }

    fun unsubscribe(id: UUID) {
        subscribers[id]?.close()
    }

    fun subscriberCount(): Int = subscribers.size

    fun publish(type: String, payload: Any): StreamEvent {
        val event = StreamEvent(nextEventId.incrementAndGet(), type, payload, clock.instant())
        subscribers.values.forEach { subscriber ->
            if (!subscriber.offer(event)) {
                // Queue full: the subscriber cannot keep up, so it is disconnected
                // rather than applying backpressure to every other consumer.
                subscriber.close()
            }
        }
        return event
    }

    fun publishGuardEvent(event: GuardEvent): StreamEvent = publish(TYPE_GUARD_EVENT, event)

    fun publishApprovalCreated(approval: Approval): StreamEvent = publish(TYPE_APPROVAL_CREATED, approval)

    fun publishApprovalResolved(approval: Approval): StreamEvent = publish(TYPE_APPROVAL_RESOLVED, approval)

    fun publishPolicyReloaded(pack: PolicyPack): StreamEvent =
        publish(TYPE_POLICY_RELOADED, mapOf("packId" to pack.id, "version" to pack.version, "enabled" to pack.enabled))

    fun publishGatewayHealth(status: String, dependencies: Map<String, Boolean>): StreamEvent =
        publish(TYPE_GATEWAY_HEALTH, mapOf("status" to status, "dependencies" to dependencies))

    companion object {
        const val TYPE_GUARD_EVENT = "guard.event"
        const val TYPE_APPROVAL_CREATED = "approval.created"
        const val TYPE_APPROVAL_RESOLVED = "approval.resolved"
        const val TYPE_POLICY_RELOADED = "policy.reloaded"
        const val TYPE_GATEWAY_HEALTH = "gateway.health"
        const val DEFAULT_CAPACITY = 256
    }
}
