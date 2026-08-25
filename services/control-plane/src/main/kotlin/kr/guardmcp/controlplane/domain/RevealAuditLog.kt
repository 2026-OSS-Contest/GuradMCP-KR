package kr.guardmcp.controlplane.domain

import com.fasterxml.jackson.annotation.JsonValue
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Component
import java.sql.PreparedStatement
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID

/** GMCP-84 §5.3. A denied attempt is recorded with the same three-valued shape as a
 *  successful one -- an unauthorized or unstored reveal attempt is itself a security-relevant
 *  observation of someone trying to see unmasked content, not a case to leave unlogged. */
enum class RevealResult(@get:JsonValue val wire: String) {
    SUCCESS("success"),
    DENIED_NO_PERMISSION("denied_no_permission"),
    DENIED_NOT_STORED("denied_not_stored");

    companion object {
        fun fromWire(value: String): RevealResult = entries.first { it.wire == value }
    }
}

data class RevealAuditLogEntry(
    val revealId: UUID,
    val eventId: UUID,
    val revealedBy: String,
    val revealedAt: Instant,
    val reason: String?,
    val sourceIp: String?,
    val result: RevealResult,
)

/**
 * `reveal_audit_log` (GMCP-84 §5.3). Every call to `POST /events/{id}/reveal` writes exactly one
 * row here -- see [kr.guardmcp.controlplane.api.AuditEventController.reveal] for the three points
 * in that method that call [record].
 *
 * Its own dedicated table rather than riding on [AuditLogStore]'s generic before/after JSON shape
 * (as this feature's first cut under GMCP-80 did): the spec's three-valued `result` and
 * `source_ip` need typed, indexable columns, not values buried inside a JSON blob.
 */
@Component
class RevealAuditLog(private val jdbcTemplate: JdbcTemplate) {
    fun record(
        eventId: UUID,
        revealedBy: String,
        reason: String?,
        sourceIp: String?,
        result: RevealResult,
    ): RevealAuditLogEntry {
        val entry = RevealAuditLogEntry(
            revealId = UUID.randomUUID(),
            eventId = eventId,
            revealedBy = revealedBy,
            revealedAt = Instant.now(),
            reason = reason,
            sourceIp = sourceIp,
            result = result,
        )
        jdbcTemplate.update({ connection ->
            val statement: PreparedStatement = connection.prepareStatement(INSERT_SQL)
            statement.setObject(1, entry.revealId)
            statement.setObject(2, entry.eventId)
            statement.setString(3, entry.revealedBy)
            statement.setTimestamp(4, Timestamp.from(entry.revealedAt))
            statement.setString(5, entry.reason)
            statement.setString(6, entry.sourceIp)
            statement.setString(7, entry.result.wire)
            statement
        })
        return entry
    }

    fun findByEventId(eventId: UUID): List<RevealAuditLogEntry> =
        jdbcTemplate.query(SELECT_BY_EVENT_SQL, rowMapper, eventId)

    fun all(): List<RevealAuditLogEntry> = jdbcTemplate.query(SELECT_ALL_SQL, rowMapper)

    private val rowMapper = RowMapper { rs, _ ->
        RevealAuditLogEntry(
            revealId = rs.getObject("reveal_id", UUID::class.java),
            eventId = rs.getObject("event_id", UUID::class.java),
            revealedBy = rs.getString("revealed_by"),
            revealedAt = rs.getTimestamp("revealed_at").toInstant(),
            reason = rs.getString("reason"),
            sourceIp = rs.getString("source_ip"),
            result = RevealResult.fromWire(rs.getString("result")),
        )
    }

    private companion object {
        const val INSERT_SQL = """
            INSERT INTO reveal_audit_log (reveal_id, event_id, revealed_by, revealed_at, reason, source_ip, result)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """
        const val SELECT_BY_EVENT_SQL = """
            SELECT reveal_id, event_id, revealed_by, revealed_at, reason, source_ip, result
            FROM reveal_audit_log WHERE event_id = ? ORDER BY revealed_at
        """
        const val SELECT_ALL_SQL = """
            SELECT reveal_id, event_id, revealed_by, revealed_at, reason, source_ip, result
            FROM reveal_audit_log ORDER BY revealed_at
        """
    }
}
