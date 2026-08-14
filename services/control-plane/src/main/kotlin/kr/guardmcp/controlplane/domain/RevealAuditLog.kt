package kr.guardmcp.controlplane.domain

import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Instant
import java.util.UUID

enum class RevealAuditAction {
    REVEAL,
    /** A non-operator's attempt — spec 3.6 recommends recording the attempt itself, not just successes. */
    REVEAL_DENIED,
}

data class RevealAuditLogEntry(
    val auditLogId: UUID,
    val eventId: UUID,
    val actorId: String,
    val action: RevealAuditAction,
    val reason: String?,
    val timestamp: Instant,
)

/**
 * Append-only reveal-access log (NFR-04, GMCP-80 §3.6). Kept separate from [AuditChain]'s
 * trust-change hash chain per the spec ("기존 해시 체인과 별개로 관리") rather than folded into it —
 * same reasoning as why trust changes have their own list instead of joining [GuardEvent] — but
 * shares its schema shape (`auditLogId`/`eventId`/`actorId`/`action`/`timestamp`) so a future
 * unified audit view can read both.
 */
@Component
class RevealAuditLog(private val clock: Clock) {
    private val lock = Any()
    private val entries = mutableListOf<RevealAuditLogEntry>()

    fun record(eventId: UUID, actorId: String, action: RevealAuditAction, reason: String?): RevealAuditLogEntry {
        val entry = RevealAuditLogEntry(UUID.randomUUID(), eventId, actorId, action, reason, clock.instant())
        synchronized(lock) { entries += entry }
        return entry
    }

    fun all(): List<RevealAuditLogEntry> = synchronized(lock) { entries.toList() }
}
