package kr.guardmcp.controlplane.domain

import io.kotest.assertions.nondeterministic.eventually
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.time.Duration.Companion.seconds

class EventStreamHubKotest : StringSpec({
    val clock = Clock.fixed(Instant.parse("2026-01-02T00:00:00Z"), ZoneOffset.UTC)

    "every subscriber receives every published event" {
        val hub = EventStreamHub(clock)
        val first = ConcurrentLinkedQueue<StreamEvent>()
        val second = ConcurrentLinkedQueue<StreamEvent>()
        hub.subscribe(first::add)
        hub.subscribe(second::add)

        hub.publish(EventStreamHub.TYPE_POLICY_RELOADED, mapOf("packId" to "default"))
        hub.publish(EventStreamHub.TYPE_GATEWAY_HEALTH, mapOf("status" to "up"))

        eventually(5.seconds) {
            first.map(StreamEvent::type) shouldBe listOf(EventStreamHub.TYPE_POLICY_RELOADED, EventStreamHub.TYPE_GATEWAY_HEALTH)
            second.map(StreamEvent::type) shouldBe listOf(EventStreamHub.TYPE_POLICY_RELOADED, EventStreamHub.TYPE_GATEWAY_HEALTH)
        }
    }

    "event ids are monotonic and typed payloads are preserved" {
        val hub = EventStreamHub(clock)
        val received = ConcurrentLinkedQueue<StreamEvent>()
        hub.subscribe(received::add)

        val firstId = hub.publish(EventStreamHub.TYPE_GUARD_EVENT, mapOf("verdict" to "block")).id
        val secondId = hub.publish(EventStreamHub.TYPE_GUARD_EVENT, mapOf("verdict" to "allow")).id

        (secondId > firstId) shouldBe true
        eventually(5.seconds) {
            received.size shouldBe 2
            received.first().payload shouldBe mapOf("verdict" to "block")
        }
    }

    "a subscriber that overflows its buffer is disconnected, others keep receiving" {
        val hub = EventStreamHub(clock)
        val closed = CountDownLatch(1)
        val blocker = CountDownLatch(1)
        val healthy = ConcurrentLinkedQueue<StreamEvent>()

        // Slow consumer: its transport parks on the first delivery, so its capacity-1
        // queue overflows on the third publish while the first event is still in flight.
        hub.subscribe(
            transport = { blocker.await() },
            capacity = 1,
            onClose = closed::countDown,
        )
        hub.subscribe(healthy::add)

        repeat(3) { index -> hub.publish(EventStreamHub.TYPE_GUARD_EVENT, mapOf("sequence" to index)) }

        closed.await(5, TimeUnit.SECONDS) shouldBe true
        blocker.countDown()
        eventually(5.seconds) {
            hub.subscriberCount() shouldBe 1
            healthy.size shouldBe 3
        }
    }

    "unsubscribe removes the subscriber and fires its close callback" {
        val hub = EventStreamHub(clock)
        val closed = CountDownLatch(1)
        val id = hub.subscribe(transport = {}, onClose = closed::countDown)

        hub.unsubscribe(id)

        closed.await(5, TimeUnit.SECONDS) shouldBe true
        hub.subscriberCount() shouldBe 0
    }
})
