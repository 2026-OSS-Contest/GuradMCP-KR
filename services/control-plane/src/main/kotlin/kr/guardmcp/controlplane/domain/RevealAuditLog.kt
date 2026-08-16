package kr.guardmcp.controlplane.domain

import com.fasterxml.jackson.annotation.JsonValue
import org.springframework.stereotype.Component
import java.time.Instant
import java.util.UUID

enum class RevealAuditAction(@get:JsonValue val wire: String) {
    REVEAL("EVENT_RAW_REVEALED"),
    /** A non-operator's attempt — spec 3.6 recommends recording the attempt itself, not just successes. */
    REVEAL_DENIED("EVENT_RAW_REVEAL_DENIED");

    companion object {
        fun fromWire(value: String): RevealAuditAction = entries.first { it.wire == value }
    }
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
 * Reveal-access log (NFR-04, GMCP-80 §3.6), backed by [AuditLogStore]'s Postgres-persisted
 * `audit_log` table rather than its own in-memory list — same generic audit trail GMCP-68's
 * settings changes use (`SETTINGS_FAILURE_POLICY_CHANGED`), so a reveal survives a restart and a
 * future unified audit view can read both without a second query surface. Kept as its own thin
 * wrapper (rather than callers using [AuditLogStore] directly) so [AuditEventController] keeps
 * its typed `eventId`/`action`/`reason` shape instead of raw `before`/`after` maps.
 */
@Component
class RevealAuditLog(private val auditLog: AuditLogStore) {
    fun record(eventId: UUID, actorId: String, action: RevealAuditAction, reason: String?): RevealAuditLogEntry {
        val record = auditLog.record(
            action = action.wire,
            actor = actorId,
            before = emptyMap(),
            after = buildMap {
                put("eventId", eventId.toString())
                if (reason != null) put("reason", reason)
            },
            // §3.6: every reveal — granted or denied — is a look at unmasked, potentially
            // sensitive original content, so both actions stand out from routine config edits.
            severity = "high",
        )
        return record.toRevealEntry()
    }

    fun all(): List<RevealAuditLogEntry> =
        (auditLog.findByAction(RevealAuditAction.REVEAL.wire) + auditLog.findByAction(RevealAuditAction.REVEAL_DENIED.wire))
            .map { it.toRevealEntry() }
            .sortedBy { it.timestamp }

    private fun AuditLogRecord.toRevealEntry() = RevealAuditLogEntry(
        auditLogId = id,
        eventId = UUID.fromString(after["eventId"] as String),
        actorId = actor,
        action = RevealAuditAction.fromWire(action),
        reason = after["reason"] as String?,
        timestamp = ts,
    )
}
