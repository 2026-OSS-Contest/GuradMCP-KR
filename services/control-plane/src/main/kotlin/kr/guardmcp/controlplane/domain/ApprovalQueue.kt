package kr.guardmcp.controlplane.domain

import org.springframework.context.annotation.Profile
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.stereotype.Component
import java.util.UUID

/** Pending-approval wait queue. Entries are added on registration and removed on any resolution. */
interface ApprovalQueue {
    fun enqueue(id: UUID)
    fun remove(id: UUID)
    fun pendingIds(): List<UUID>
}

@Component
@Profile("!compose")
class InMemoryApprovalQueue : ApprovalQueue {
    private val lock = Any()
    private val ids = linkedSetOf<UUID>()

    override fun enqueue(id: UUID) {
        synchronized(lock) { ids += id }
    }

    override fun remove(id: UUID) {
        synchronized(lock) { ids -= id }
    }

    override fun pendingIds(): List<UUID> = synchronized(lock) { ids.toList() }
}

/**
 * Redis-backed queue used in the composed deployment. The key matches
 * infra/redis/001-demo-seed.sh so the seeded pending approval is visible.
 */
@Component
@Profile("compose")
class RedisApprovalQueue(private val redis: StringRedisTemplate) : ApprovalQueue {
    override fun enqueue(id: UUID) {
        redis.opsForList().rightPush(QUEUE_KEY, id.toString())
    }

    override fun remove(id: UUID) {
        redis.opsForList().remove(QUEUE_KEY, 0, id.toString())
    }

    override fun pendingIds(): List<UUID> =
        redis.opsForList().range(QUEUE_KEY, 0, -1).orEmpty().map(UUID::fromString)

    companion object {
        const val QUEUE_KEY = "guardmcp:approval:queue"
    }
}
